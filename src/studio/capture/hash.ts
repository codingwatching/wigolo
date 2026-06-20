import { createHash } from 'node:crypto';

/**
 * Content hash for a captured Studio artifact. The artifact `type` is folded
 * into the digest so identical content under different types never collides,
 * and a NUL (`\0`) separator joins the type and every part — NUL cannot appear
 * in the canonical text, so the field boundaries are unambiguous (a plain
 * concatenation would let `('note','foo')` and `('not','efoo')` collide). The
 * type vocabulary is expected to grow, so the separator — not prefix-freeness —
 * is what keeps the namespacing durable.
 *
 * Hashes the RAW canonical content: no whitespace or case normalization. Pure —
 * no I/O, no state — so the same `(type, ...parts)` is always the same hex digest.
 */
export function hashArtifact(type: string, ...parts: string[]): string {
  return createHash('sha256')
    .update([type, ...parts].join('\0'))
    .digest('hex');
}
