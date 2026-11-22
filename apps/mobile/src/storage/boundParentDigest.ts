import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import type { ConversationArtifact } from './conversationArtifactCodec';

// Keep one potentially costly string only; small intermediate nodes need not
// evict a deep parent's digest and oversize payloads are never retained.
const minimumUnits = 8 * 1024;
const maximumUnits = 1024 * 1024;

export type BoundParentDigest = (
  raw: string,
  decoded: ConversationArtifact,
  expected: string,
) => string;

/** Memoize canonicalization only; the caller still decodes and proves every edge. */
export function createBoundParentDigest(
  owned: () => boolean,
): BoundParentDigest {
  let previous: { raw: string; digest: string } | undefined;
  return (raw, decoded, expected) => {
    if (!owned()) {
      previous = undefined;
      return fingerprint(decoded);
    }
    if (raw.length < minimumUnits || raw.length > maximumUnits)
      return fingerprint(decoded);
    if (previous?.raw === raw) return previous.digest;
    const digest = fingerprint(decoded);
    previous = digest === expected ? { raw, digest } : undefined;
    return digest;
  };
}
