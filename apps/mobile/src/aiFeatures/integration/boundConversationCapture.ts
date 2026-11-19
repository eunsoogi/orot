import { boundCaptureAuthorityUnchanged } from './boundCaptureAuthority';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import {
  prepareCaptureSources,
  type ConversationCaptureOwner,
} from './evidenceCaptureBatch';
import { stableEvidenceReference } from './stableEvidenceReference';
import { fingerprint } from './evidenceUtils';

/** Issued only by discovery's storage owner and explicitly supplied to binding.
 * The inner alias keeps its own native/summary/research/live validation; no graph
 * authority is transferred to it. Both outer fences remain ordinary strict reads. */
export function createBoundConversationCaptureOwner(input: {
  storage: Pick<
    ReturnType<typeof createConversationArtifactStorage>,
    'readMany'
  >;
  registry: LocalEvidenceReferenceRegistry;
}): ConversationCaptureOwner {
  const owner: ConversationCaptureOwner = {
    registry: input.registry,
    async prepare(requests, signal, reads) {
      const bindings = requests.map(request => {
        if (!request.bound) throw new Error('Missing bound capture authority.');
        return request.bound;
      });
      const current = async () => {
        if (signal.aborted || !boundCaptureAuthorityUnchanged(owner))
          return false;
        const rows = await (
          reads?.forStorage(input.storage) ?? input.storage
        ).readMany(bindings.map(binding => binding.parentId));
        return (
          !signal.aborted &&
          boundCaptureAuthorityUnchanged(owner) &&
          rows.length === bindings.length &&
          rows.every((row, index) =>
            Boolean(
              row && fingerprint(row) === bindings[index]!.parentRevision,
            ),
          )
        );
      };
      if (!(await current()))
        throw new Error('The outer conversation parent changed.');
      const inner = await prepareCaptureSources(
        input.registry,
        bindings.map(binding => binding.reference),
        signal,
        { recheckFallback: true, reads },
      );
      return {
        results: bindings.map(
          binding =>
            inner.results.get(stableEvidenceReference(binding.reference)) ?? {
              status: 'unavailable' as const,
            },
        ),
        finish: async () =>
          !signal.aborted &&
          (await inner.finish()) &&
          (await current()) &&
          !signal.aborted,
      };
    },
  };
  return owner;
}
