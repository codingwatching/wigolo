import { describe, it, expect } from 'vitest';
import { buildSnapshot, PageSnapshotter } from '../../../../src/studio/perception/snapshot.js';

const attrsArr = (o = {}) => Object.entries(o).flat();
const tagFor = (role) => (role === 'textbox' ? 'input' : role === 'link' ? 'a' : 'button');

/**
 * Build a fake getFullAXTree + DOM.getDocument(pierce:true) pair from a flat spec.
 * `shadow:'closed'` places the node inside a CLOSED shadow root — reachable here
 * exactly as the privileged CDP path (DOM.getDocument pierce) reaches it; a
 * page-script DOM read could not, which is the failure this guards against.
 */
function build(specs) {
  const axNodes = specs.map((s) => ({ ignored: false, role: { value: s.role }, name: { value: s.name }, backendDOMNodeId: s.be }));
  const light = [];
  const closed = [];
  for (const s of specs) {
    const node = { backendNodeId: s.be, localName: tagFor(s.role), attributes: attrsArr(s.attrs) };
    (s.shadow === 'closed' ? closed : light).push(node);
  }
  const body = {
    backendNodeId: 2,
    localName: 'body',
    children: [
      ...light,
      ...(closed.length
        ? [{ backendNodeId: 90, localName: 'closed-widget', shadowRoots: [{ backendNodeId: 91, shadowRootType: 'closed', children: closed }] }]
        : []),
    ],
  };
  return { axNodes, root: { backendNodeId: 1, localName: 'html', children: [body] } };
}

const snap = (specs, opts = {}) => {
  const { axNodes, root } = build(specs);
  return buildSnapshot(axNodes, root, { tokenBudget: opts.tokenBudget ?? 1200 });
};

describe('buildSnapshot — pure AX ⋈ DOM join', () => {
  it('keeps interactive elements, drops ignored/uninteresting, and exposes a lean {ref,role,name} view', () => {
    const s = snap([
      { be: 10, role: 'button', name: 'Open' },
      { be: 11, role: 'textbox', name: 'Email' },
    ]);
    expect(s.elements.map((e) => e.name).sort()).toEqual(['Email', 'Open']);
    expect(Object.keys(s.elements[0]).sort()).toEqual(['name', 'ref', 'role']); // no backendNodeId leak
  });

  it('refs are STABLE across a content-preserving re-render (same role/name/position, NEW backendNodeIds)', () => {
    const before = snap([{ be: 10, role: 'button', name: 'Task 1' }, { be: 11, role: 'button', name: 'Task 2' }]);
    const after = snap([{ be: 77, role: 'button', name: 'Task 1' }, { be: 78, role: 'button', name: 'Task 2' }]); // identity swap
    expect(after.elements.map((e) => e.ref)).toEqual(before.elements.map((e) => e.ref)); // THE load-bearing property
    // backend-only would have produced different refs here; this is what disqualifies it.
  });

  it('is a PURE function — identical input yields identical output (cold == warm; no counter)', () => {
    const specs = [{ be: 10, role: 'button', name: 'Save' }, { be: 11, role: 'button', name: 'Save' }];
    expect(snap(specs)).toEqual(snap(specs.map((x) => ({ ...x }))));
  });

  it('identical-sibling run: distinct refs (not ambiguous) + low-confidence at snapshot time', () => {
    const s = snap([
      { be: 10, role: 'button', name: 'Delete' },
      { be: 11, role: 'button', name: 'Delete' },
      { be: 12, role: 'button', name: 'Delete' },
    ]);
    expect(new Set(s.elements.map((e) => e.ref)).size).toBe(3);
    expect(s.elements.every((e) => e.confidence === 'low')).toBe(true);
  });

  it('CLOSED-shadow nodes are present AND fingerprinted from their privileged attrs (not degraded to role+name)', () => {
    // Two closed-shadow buttons, same role+name, distinguished ONLY by a stable attr
    // reachable via the pierced DOM. If the attr side degraded (page-script read),
    // they would collide (the fp-only 0%-uniqueness failure). They must stay distinct.
    const s = snap([
      { be: 30, role: 'textbox', name: 'Field', attrs: { name: 'first' }, shadow: 'closed' },
      { be: 31, role: 'textbox', name: 'Field', attrs: { name: 'last' }, shadow: 'closed' },
    ]);
    expect(s.elements.length).toBe(2); // both observed inside the closed root
    expect(new Set(s.elements.map((e) => e.ref)).size).toBe(2); // unique via privileged attr
    expect(s.elements.every((e) => e.confidence === undefined)).toBe(true); // distinct fp → high confidence
  });

  it('measures token size and flags over-budget; refMap carries backendNodeId host-side only', () => {
    const s = snap([{ be: 10, role: 'button', name: 'Open' }], { tokenBudget: 100000 });
    expect(s.tokenCount).toBeGreaterThan(0);
    expect(s.overBudget).toBe(false);
    expect(s.refMap.get(s.elements[0].ref)).toBe(10); // ref → live backendNodeId, NOT in the agent payload
    expect(snap([{ be: 10, role: 'button', name: 'Open' }], { tokenBudget: 1 }).overBudget).toBe(true);
  });
});

describe('PageSnapshotter.snapshot — async over a CDP session', () => {
  it('queries getFullAXTree + DOM.getDocument(pierce:true) and returns the built snapshot', async () => {
    const { axNodes, root } = build([{ be: 10, role: 'button', name: 'Go' }]);
    const sent = [];
    const cdp = {
      send: async (method, params) => {
        sent.push(method);
        if (method === 'Accessibility.getFullAXTree') return { nodes: axNodes };
        if (method === 'DOM.getDocument') { expect(params).toMatchObject({ pierce: true }); return { root }; }
        return {};
      },
      on: () => {},
      off: () => {},
    };
    const s = await new PageSnapshotter({ tokenBudget: 1200 }).snapshot(cdp);
    expect(sent).toContain('Accessibility.getFullAXTree');
    expect(sent).toContain('DOM.getDocument');
    expect(s.elements).toEqual([{ ref: expect.stringMatching(/^e[0-9a-z]+$/), role: 'button', name: 'Go' }]);
  });
});
