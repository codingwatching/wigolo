/**
 * On-demand vision escalation — the EXPENSIVE, untrusted, head-sensitive path. Kept
 * rare, legible, and bounded:
 *
 *  - CLOSED trigger set. Only canvas / non-semantic visual, cross-origin OOPIF, and
 *    marked-but-unresolved escalate. SHADOW DOM is NOT a trigger (2D retired it — the
 *    a11y tree already carries open/nested/closed). No open-ended "escalate when the
 *    snapshot feels incomplete" — loose triggers are how you reach the ~114K-tokens/
 *    task workload the a11y-default exists to avoid.
 *  - HARD per-turn budget + rate cap, so even a misfiring trigger can't spam pixels.
 *  - CROP-FIRST, not downscale-the-world: capture the ROI at usable resolution (a
 *    full-page screenshot squeezed under the byte cap goes unreadable exactly on the
 *    small text / fine canvas detail that motivated escalating).
 *  - Output carries the REGION (the 2J action locus) — resolving "what" without
 *    "where" is a half-escalation.
 *  - Tagged `trusted: false`: a page can render "ignore your instructions…" as pixels
 *    that text-sanitization never sees. Vision output sits on the data side of the
 *    trust boundary from the start; Phase 6 hardens an already-tagged channel.
 */
import { writeSpill } from './spill.js';

export type VisionTrigger = 'canvas' | 'oopif' | 'marked_unresolved';

/** The closed set. Membership is checked at runtime so a stray/retired trigger is refused, not silently captured. */
export const VISION_TRIGGERS: ReadonlySet<string> = new Set<VisionTrigger>(['canvas', 'oopif', 'marked_unresolved']);

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisionResult {
  trigger: VisionTrigger;
  /** The captured ROI — the locus the 2J coordinate path acts on. */
  region: Region;
  image: { format: 'png'; base64?: string; spillRef?: string };
  bytes: number;
  /** UNTRUSTED data channel — page-rendered pixels are not instructions. Phase 6 enforces; this tags from the start. */
  trusted: false;
}

/** Per-turn vision budget: a rate cap (maxCalls) AND a byte cap. The host resets it each agent turn. */
export class VisionBudget {
  private calls = 0;
  private bytes = 0;
  constructor(private readonly maxCalls: number, private readonly maxBytes: number) {}
  canEscalate(): boolean {
    return this.calls < this.maxCalls && this.bytes < this.maxBytes;
  }
  record(bytes: number): void {
    this.calls += 1;
    this.bytes += bytes;
  }
  reset(): void {
    this.calls = 0;
    this.bytes = 0;
  }
  get state(): { calls: number; bytes: number } {
    return { calls: this.calls, bytes: this.bytes };
  }
}

export interface VisionCdp {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export type EscalateResult =
  | { ok: true; result: VisionResult }
  | { ok: false; reason: 'unknown_trigger' | 'vision_budget_exceeded' | 'invalid_region' | 'capture_failed' };

export interface EscalateOptions {
  inlineByteCap: number;
  dataDir?: string;
}

/**
 * Hard cap on a single capture's clip dimensions. The region is page-influenced (box
 * geometry), so without this a hostile page reporting an enormous element could force
 * ONE giant rasterization before the per-turn byte budget catches the NEXT call.
 * Deliberately NOT operator-tunable — a clamp you cannot crank up to unsafe is safer
 * than one you can.
 */
const MAX_REGION_PX = 4096;

/** Capture a cropped screenshot for a closed-set trigger, within budget. Fail-loud on an unknown trigger or budget exhaustion. */
export async function escalate(
  cdp: VisionCdp,
  req: { trigger: VisionTrigger; region: Region },
  budget: VisionBudget,
  opts: EscalateOptions,
): Promise<EscalateResult> {
  if (!VISION_TRIGGERS.has(req.trigger)) return { ok: false, reason: 'unknown_trigger' };
  if (!budget.canEscalate()) return { ok: false, reason: 'vision_budget_exceeded' };

  // Sanitize + clamp the page-influenced region: reject malformed dims, and bound the
  // clip so ONE capture can't be unbounded (the byte budget only catches the NEXT call).
  // Clamping (not refusing) keeps an over-large element's ROI useful.
  const { x: rx, y: ry, width: rw, height: rh } = req.region;
  if (![rx, ry, rw, rh].every((n) => Number.isFinite(n)) || rw <= 0 || rh <= 0) {
    return { ok: false, reason: 'invalid_region' };
  }
  const region: Region = { x: Math.max(0, rx), y: Math.max(0, ry), width: Math.min(rw, MAX_REGION_PX), height: Math.min(rh, MAX_REGION_PX) };

  let shot: { data?: string };
  try {
    shot = (await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { ...region, scale: 1 }, // crop-first — the (clamped) ROI, not the viewport
      captureBeyondViewport: true,
    })) as { data?: string };
  } catch {
    return { ok: false, reason: 'capture_failed' }; // a rejecting CDP send is reported as data, not thrown
  }
  if (!shot.data) return { ok: false, reason: 'capture_failed' };

  const bytes = Buffer.byteLength(shot.data, 'base64');
  budget.record(bytes);

  const image: VisionResult['image'] =
    bytes > opts.inlineByteCap
      ? { format: 'png', spillRef: writeSpill({ format: 'png', base64: shot.data }, opts.dataDir) }
      : { format: 'png', base64: shot.data };

  return { ok: true, result: { trigger: req.trigger, region, image, bytes, trusted: false } }; // echo the CAPTURED (clamped) region
}
