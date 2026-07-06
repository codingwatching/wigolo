/**
 * Domain input-event types for the studio drive channel. Relocated out of the (deleted) v1
 * `input.ts` — the human screencast→CDP `InputForwarder` died with the streaming stack (spec §9);
 * the AGENT synthetic-input path is rebuilt in the Electron app as `debuggerInputSink`. These pure
 * types are all that survivors (session-control, act, the app's input sink) need. No screencast /
 * FrameMetadata dependency.
 */

export type MouseButton = 'none' | 'left' | 'middle' | 'right' | 'back' | 'forward';

export interface MouseInput {
  type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';
  nx: number;
  ny: number;
  button?: MouseButton;
  buttons?: number;
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  modifiers?: number;
}

export interface KeyInput {
  type: 'keyDown' | 'keyUp' | 'rawKeyDown' | 'char';
  key: string;
  /** Physical key code (e.g. `KeyA`). Absent for a `char` text-insertion event, which carries only `text`. */
  code?: string;
  text?: string;
  modifiers?: number;
  windowsVirtualKeyCode?: number;
}

/**
 * A page-CSS-px mouse event for the AGENT path. The resolver returns a VIEWPORT-relative CSS-px
 * centre — the same space `Input.dispatchMouseEvent`/`DOM.getBoxModel` use — so these are dispatched
 * verbatim, not through any normalized→page mapping.
 */
export interface AgentMouseInput {
  type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';
  x: number;
  y: number;
  button?: MouseButton;
  buttons?: number;
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  modifiers?: number;
}

/**
 * One sub-event of a balanced agent input UNIT (a click = mouse-down+up; a keystroke = optional
 * modifier-down / keyDown / char / keyUp / modifier-up). The channel fires all sub-events of a unit
 * atomically in one synchronous block.
 */
export type AgentInputEvent = ({ kind: 'mouse' } & AgentMouseInput) | ({ kind: 'key' } & KeyInput);
