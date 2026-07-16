import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tmpHome: string;
let tmpData: string;
let tmpCwd: string;

// Controllable writeFileSync: defaults to pass-through; a test can install a
// custom impl to inject failures. ESM export spies aren't configurable, so we
// mock node:fs and route writeFileSync through this mutable hook.
let writeHook: ((p: unknown, data: unknown, opts: unknown) => void) | null = null;
const writeCalls: unknown[][] = [];

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: (p: unknown, data: unknown, opts: unknown) => {
      writeCalls.push([p, data, opts]);
      if (writeHook) return writeHook(p, data, opts);
      return actual.writeFileSync(p as string, data as string, opts as never);
    },
  };
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: vi.fn(() => tmpHome) };
});

vi.mock('../../../../../src/config.js', () => ({
  getConfig: vi.fn(() => ({ dataDir: tmpData })),
}));

async function loadExec() {
  return import('../../../../../src/cli/agents/skills/executor.js');
}
async function loadPlan() {
  return import('../../../../../src/cli/agents/skills/planner.js');
}
async function loadCat() {
  return import('../../../../../src/cli/agents/skills/catalog.js');
}

beforeEach(() => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  tmpHome = join(tmpdir(), `wigolo-exec-home-${stamp}`);
  tmpData = join(tmpdir(), `wigolo-exec-data-${stamp}`);
  tmpCwd = join(tmpdir(), `wigolo-exec-cwd-${stamp}`);
  for (const d of [tmpHome, tmpData, tmpCwd]) mkdirSync(d, { recursive: true });
  writeHook = null;
  writeCalls.length = 0;
  vi.resetModules();
});

afterEach(() => {
  writeHook = null;
  for (const d of [tmpHome, tmpData, tmpCwd]) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('applySkillsPlan — fresh install', () => {
  it('writes all pack files and records a receipt', async () => {
    const { planSkills } = await loadPlan();
    const { applySkillsPlan } = await loadExec();
    const plan = planSkills({ scope: 'global', agents: ['claude-code'], packs: ['wigolo'], cwd: tmpCwd });
    const res = applySkillsPlan(plan);
    const skillMd = join(tmpHome, '.claude', 'skills', 'wigolo', 'SKILL.md');
    expect(existsSync(skillMd)).toBe(true);
    expect(res.written.length).toBeGreaterThan(0);
    expect(existsSync(join(tmpData, 'skills', 'receipts.json'))).toBe(true);
  });

  it('re-apply of an unchanged install performs ZERO write calls', async () => {
    const { planSkills } = await loadPlan();
    const { applySkillsPlan } = await loadExec();
    applySkillsPlan(planSkills({ scope: 'global', agents: ['claude-code'], packs: ['wigolo'], cwd: tmpCwd }));

    // Re-plan (now sees receipt + on-disk match) → unchanged, no writes.
    const plan2 = planSkills({ scope: 'global', agents: ['claude-code'], packs: ['wigolo'], cwd: tmpCwd });
    expect(plan2.actions.find((a) => a.packs[0] === 'wigolo')!.status).toBe('unchanged');
    writeCalls.length = 0;
    applySkillsPlan(plan2);
    const skillWrites = writeCalls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes(join('skills', 'wigolo')),
    );
    expect(skillWrites).toEqual([]);
  });
});

describe('applySkillsPlan — rollback injection', () => {
  it('mid-apply write failure rolls back files created THIS run, receipt not written', async () => {
    const { planSkills } = await loadPlan();
    const { applySkillsPlan } = await loadExec();
    const plan = planSkills({ scope: 'global', agents: ['claude-code'], packs: ['wigolo'], cwd: tmpCwd });

    const packDir = join(tmpHome, '.claude', 'skills', 'wigolo');
    const { writeFileSync: realWrite } = await vi.importActual<typeof import('node:fs')>('node:fs');
    let managedWrites = 0;
    writeHook = (p, data, opts) => {
      const path = String(p);
      const isManaged = path.startsWith(packDir) && !path.includes('.tmp-');
      if (isManaged) {
        managedWrites += 1;
        if (managedWrites === 2) throw new Error('disk full');
      }
      return realWrite(p as string, data as string, opts as never);
    };

    expect(() => applySkillsPlan(plan)).toThrow(/disk full/);
    writeHook = null;

    // First created file must have been rolled back (unlinked); an empty pack
    // dir may also have been pruned.
    const written = existsSync(packDir)
      ? readdirSync(packDir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).length
      : 0;
    expect(written).toBe(0);

    // No receipt should have been written (receipt is LAST, after all files).
    const rcpt = join(tmpData, 'skills', 'receipts.json');
    const store = existsSync(rcpt) ? JSON.parse(readFileSync(rcpt, 'utf-8')) : {};
    const hasWigolo = Object.values(store).some((e) => {
      const packs = (e as { packs?: Record<string, unknown> }).packs;
      return packs && 'wigolo' in packs;
    });
    expect(hasWigolo).toBe(false);
  });
});

describe('removeSkills — modified refusal + survivors', () => {
  it('refuses to remove a user-modified pack file without force', async () => {
    const { planSkills } = await loadPlan();
    const { applySkillsPlan, removeSkills } = await loadExec();
    applySkillsPlan(planSkills({ scope: 'global', agents: ['claude-code'], packs: ['wigolo'], cwd: tmpCwd }));

    const skillMd = join(tmpHome, '.claude', 'skills', 'wigolo', 'SKILL.md');
    writeFileSync(skillMd, 'USER EDITED THIS', 'utf-8');

    const res = removeSkills({ scope: 'global', agents: ['claude-code'], packs: ['wigolo'], cwd: tmpCwd });
    expect(res.refused.length).toBeGreaterThan(0);
    expect(existsSync(skillMd)).toBe(true); // not deleted
  });

  it('force removes managed files but a user notes.md survives + dir kept', async () => {
    const { planSkills } = await loadPlan();
    const { applySkillsPlan, removeSkills } = await loadExec();
    applySkillsPlan(planSkills({ scope: 'global', agents: ['claude-code'], packs: ['wigolo'], cwd: tmpCwd }));

    const packDir = join(tmpHome, '.claude', 'skills', 'wigolo');
    const notes = join(packDir, 'notes.md');
    writeFileSync(notes, 'my private notes', 'utf-8');
    // Also modify a managed file so force is exercised.
    writeFileSync(join(packDir, 'SKILL.md'), 'edited', 'utf-8');

    const res = removeSkills({ scope: 'global', agents: ['claude-code'], packs: ['wigolo'], cwd: tmpCwd, force: true });
    expect(existsSync(notes)).toBe(true); // user file untouched
    expect(existsSync(packDir)).toBe(true); // dir kept because notes survives
    expect(res.notices.some((n) => /survive/.test(n))).toBe(true);
  });
});

describe('removeSkills — shared-path two-agent sequence', () => {
  it('remove codex ⇒ files intact + receipt decremented; remove cursor ⇒ files gone', async () => {
    const { planSkills } = await loadPlan();
    const { applySkillsPlan, removeSkills } = await loadExec();
    // Install codex + cursor to the shared .agents/skills base.
    applySkillsPlan(planSkills({ scope: 'project', agents: ['codex', 'cursor'], packs: ['wigolo'], cwd: tmpCwd }));
    const skillMd = join(tmpCwd, '.agents', 'skills', 'wigolo', 'SKILL.md');
    expect(existsSync(skillMd)).toBe(true);

    // Remove codex — shared receipt lists [codex, cursor] → decrement only.
    removeSkills({ scope: 'project', agents: ['codex'], packs: ['wigolo'], cwd: tmpCwd });
    expect(existsSync(skillMd)).toBe(true);

    // Remove cursor — now sole owner → files deleted.
    removeSkills({ scope: 'project', agents: ['cursor'], packs: ['wigolo'], cwd: tmpCwd });
    expect(existsSync(skillMd)).toBe(false);
  });
});

describe('removeSkills — structural bounds', () => {
  it('refuses a forged receipt key outside bounds and never deletes', async () => {
    const { removeSkills } = await loadExec();
    // Forge a receipt claiming an out-of-bounds path.
    const evilDir = join(tmpHome, 'evil');
    mkdirSync(evilDir, { recursive: true });
    const victim = join(evilDir, 'victim.txt');
    writeFileSync(victim, 'do not delete me', 'utf-8');
    mkdirSync(join(tmpData, 'skills'), { recursive: true });
    writeFileSync(
      join(tmpData, 'skills', 'receipts.json'),
      JSON.stringify({
        [evilDir]: {
          scope: 'global', agents: ['claude-code'],
          packs: { wigolo: { version: '1', files: { 'victim.txt': 'x' } } },
          installedAt: 'now',
        },
      }),
      'utf-8',
    );
    // removeAllSkills should bounds-refuse this key.
    const { removeAllSkills } = await loadExec();
    const res = removeAllSkills({ cwd: tmpCwd });
    expect(existsSync(victim)).toBe(true);
    expect(res.refused.some((r) => /bounds/.test(r.reason ?? ''))).toBe(true);
    void removeSkills;
  });
});

describe('removeAllSkills — legacy-bytes sweep with EMPTY receipts', () => {
  it('removes canonical-byte pack files even with no receipt store', async () => {
    const { planSkills } = await loadPlan();
    const { applySkillsPlan, removeAllSkills } = await loadExec();
    // Install then wipe the receipt store — simulating a legacy/receiptless install.
    applySkillsPlan(planSkills({ scope: 'global', agents: ['claude-code'], packs: ['wigolo'], cwd: tmpCwd }));
    rmSync(join(tmpData, 'skills', 'receipts.json'), { force: true });

    const skillMd = join(tmpHome, '.claude', 'skills', 'wigolo', 'SKILL.md');
    expect(existsSync(skillMd)).toBe(true);

    removeAllSkills({ cwd: tmpCwd });
    // Canonical bytes are recognized via catalog hash → safe to remove.
    expect(existsSync(skillMd)).toBe(false);
  });
});

describe('applySkillsPlan — .wigolo-bak never deleted', () => {
  it('leaves a pre-existing .wigolo-bak sibling untouched on windsurf global merge', async () => {
    const { planSkills } = await loadPlan();
    const { applySkillsPlan } = await loadExec();
    const dir = join(tmpHome, '.codeium', 'windsurf', 'memories');
    mkdirSync(dir, { recursive: true });
    const bak = join(dir, 'global_rules.md.wigolo-bak');
    writeFileSync(bak, 'backup content', 'utf-8');
    applySkillsPlan(planSkills({ scope: 'global', agents: ['windsurf'], cwd: tmpCwd }));
    expect(existsSync(bak)).toBe(true);
    expect(readFileSync(bak, 'utf-8')).toBe('backup content');
  });
});

describe('listSkills', () => {
  it('reports installed after a fresh install', async () => {
    const { planSkills } = await loadPlan();
    const { applySkillsPlan, listSkills } = await loadExec();
    applySkillsPlan(planSkills({ scope: 'global', agents: ['claude-code'], packs: ['wigolo'], cwd: tmpCwd }));
    const list = listSkills({ scope: 'global', agents: ['claude-code'], packs: ['wigolo'], cwd: tmpCwd });
    expect(list.find((e) => e.pack === 'wigolo')!.state).toBe('installed');
  });

  it('reports modified when a managed file is edited', async () => {
    const { planSkills } = await loadPlan();
    const { applySkillsPlan, listSkills } = await loadExec();
    applySkillsPlan(planSkills({ scope: 'global', agents: ['claude-code'], packs: ['wigolo'], cwd: tmpCwd }));
    writeFileSync(join(tmpHome, '.claude', 'skills', 'wigolo', 'SKILL.md'), 'edited', 'utf-8');
    const list = listSkills({ scope: 'global', agents: ['claude-code'], packs: ['wigolo'], cwd: tmpCwd });
    expect(list.find((e) => e.pack === 'wigolo')!.state).toBe('modified');
  });

  it('reports absent when nothing installed', async () => {
    const { listSkills } = await loadExec();
    const list = listSkills({ scope: 'global', agents: ['claude-code'], packs: ['wigolo'], cwd: tmpCwd });
    expect(list.find((e) => e.pack === 'wigolo')!.state).toBe('absent');
  });

  it('NEVER writes (pure)', async () => {
    const { listSkills } = await loadExec();
    writeCalls.length = 0;
    listSkills({ scope: 'global', agents: ['claude-code'], cwd: tmpCwd });
    expect(writeCalls).toEqual([]);
  });
});
