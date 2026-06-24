/**
 * Client-side screencast frame sink (S4).
 *
 * The host streams base64 JPEG frames lock-step: it sends one, then advances only on the client's `ack`
 * (or a timeout). So this sink:
 *   - decodes+paints one frame at a time and ACKs after each paint (the pacing signal the host waits on);
 *   - COALESCES under load — while a paint is in flight, a newly-arrived frame replaces any still-queued
 *     one (the viewer only ever wants the freshest frame; stale intermediates are dropped, not buffered);
 *   - enforces an 8 MB client backpressure ceiling mirroring the host's per-client send cap — a frame that
 *     would push buffered (in-flight + queued) bytes over the ceiling is DROPPED rather than admitted, so a
 *     burst (e.g. on reconnect) can never balloon client memory.
 *
 * The decode/draw is INJECTED so the queue/drop/ack logic is unit-testable without a real canvas; the real
 * canvas draw is `createCanvasDraw` (used by the browser pane).
 */

/** Mirrors the host's DEFAULT_FRAME_BACKPRESSURE_BYTES (ws-hub) — the client analog of the per-client cap. */
const DEFAULT_MAX_BUFFERED_BYTES = 8_000_000;
const JPEG_DATA_URI_PREFIX = 'data:image/jpeg;base64,';

export interface FrameSinkDeps {
  /** Decode the data URI and paint it (real impl: Image + ctx.drawImage). May be async (resolves on paint). */
  draw: (dataUri: string) => Promise<void> | void;
  /** Acknowledge a painted frame to the host (the lock-step pacing signal). Wire to codec up.ack() → ws.send. */
  sendAck: () => void;
  /** Client backpressure ceiling in bytes (default 8 MB). */
  maxBufferedBytes?: number;
}

export class FrameSink {
  private readonly draw: (dataUri: string) => Promise<void> | void;
  private readonly sendAck: () => void;
  private readonly max: number;
  private busy = false;
  private queued: string | null = null; // coalesced newest pending frame (base64), at most one
  private bufferedBytes = 0;
  private _dropped = 0;
  private _painted = 0;

  constructor(deps: FrameSinkDeps) {
    this.draw = deps.draw;
    this.sendAck = deps.sendAck;
    this.max = deps.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
  }

  /** Frames dropped to backpressure or coalescing. */
  get dropped(): number {
    return this._dropped;
  }
  /** Frames painted (== acks sent). */
  get painted(): number {
    return this._painted;
  }

  /** Ingest one base64 JPEG frame. Returns false when the frame was backpressure-dropped. */
  onFrame(data: string): boolean {
    const bytes = data.length;
    if (this.bufferedBytes + bytes > this.max) {
      this._dropped++; // backpressure: admitting this frame would exceed the client ceiling
      return false;
    }
    if (this.busy) {
      // Coalesce: a paint is in flight — keep only the newest frame, dropping any prior still-queued one.
      if (this.queued !== null) {
        this.bufferedBytes -= this.queued.length;
        this._dropped++;
      }
      this.queued = data;
      this.bufferedBytes += bytes;
      return true;
    }
    this.bufferedBytes += bytes;
    void this.paint(data);
    return true;
  }

  private async paint(data: string): Promise<void> {
    this.busy = true;
    try {
      await this.draw(JPEG_DATA_URI_PREFIX + data);
    } finally {
      this.bufferedBytes -= data.length;
      this._painted++;
      this.sendAck(); // ack after paint — the host advances the stream on this
      this.busy = false;
      if (this.queued !== null) {
        const next = this.queued;
        this.queued = null;
        void this.paint(next);
      }
    }
  }
}

/** Real canvas draw: decode the data URI to an Image and blit it to the 2D context, scaled to the canvas. */
export function createCanvasDraw(ctx: CanvasRenderingContext2D, width: number, height: number): (uri: string) => Promise<void> {
  return (uri: string) =>
    new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
        resolve();
      };
      img.onerror = () => reject(new Error('frame decode failed'));
      img.src = uri;
    });
}
