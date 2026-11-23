import type { EvidenceChunk } from '@orot/rag';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceRepository';
import { stableJson } from './evidenceUtils';
import {
  bindExactReproof,
  type EvidenceValidationContext,
  type ReadValidationChunks,
} from './evidenceValidationContext';

export function personalChunkReproof(
  input: {
    readonly loadCurrentPersistedChunks: () => Promise<
      readonly EvidenceChunk[]
    >;
    readonly loadCurrentPersistedChunksFor?: ReadValidationChunks;
  },
  entry: LocalHealthEvidenceRecord,
  prior: EvidenceChunk | undefined,
  work: (
    signal: AbortSignal,
    compare: () => Promise<boolean>,
    context: EvidenceValidationContext,
  ) => Promise<boolean>,
) {
  if (!prior)
    return (signal: AbortSignal, context: EvidenceValidationContext) =>
      work(signal, async () => true, context);
  const reader = input.loadCurrentPersistedChunksFor;
  const identity = { kind: entry.kind, id: entry.record.id };
  const validate = (signal: AbortSignal, context: EvidenceValidationContext) =>
    work(
      signal,
      async () => {
        const chunks = await ((reader &&
          context.readSelectedChunks?.(reader, identity, signal)) ||
          context.once(
            input.loadCurrentPersistedChunks,
            input.loadCurrentPersistedChunks,
          ));
        const current = chunks.find(chunk => chunk.id === prior.id);
        // Both paths compare current persisted content and metadata including transcript revision.
        return !!current && stableJson(current) === stableJson(prior);
      },
      context,
    );
  return reader ? bindExactReproof(validate, reader, identity) : validate;
}
