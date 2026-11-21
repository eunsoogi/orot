import {
  boundCaptureAuthorityUnchanged,
  ownsBoundCaptureAuthority,
} from './boundCaptureAuthority';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { readOwnedBoundParentRows } from '../../storage/conversationArtifactRead';
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
        const scoped = reads?.forStorage(input.storage);
        const ids = bindings.map(binding => binding.parentId);
        const witnessed =
          scoped && ownsBoundCaptureAuthority(owner)
            ? await readOwnedBoundParentRows(scoped, input.storage, signal, ids)
            : undefined;
        const witnessedRows = witnessed?.rows;
        // Revocation can mean the scoped callback itself was replaced during
        // the read. Recheck authority and retry through the stock reader only.
        if (
          witnessed &&
          !witnessedRows &&
          (signal.aborted || !ownsBoundCaptureAuthority(owner))
        )
          return false;
        const rows =
          witnessedRows ??
          (await (
            witnessed ? input.storage : (scoped ?? input.storage)
          ).readMany(ids));
        const tokens = witnessedRows ? witnessed?.tokens : undefined;
        let lastToken: number | undefined;
        let lastDigest: string | undefined;
        return (
          !signal.aborted &&
          boundCaptureAuthorityUnchanged(owner) &&
          rows.length === bindings.length &&
          rows.every((row, index) => {
            if (!row) return false;
            const token = tokens?.[index];
            // Canonicalization keeps its original post-settlement error and
            // short-circuit ordering; equality is witnessed only by owned SQL.
            const digest =
              token !== undefined && token === lastToken
                ? lastDigest
                : fingerprint(row);
            lastToken = token;
            lastDigest = digest;
            return (
              digest !== undefined && digest === bindings[index]!.parentRevision
            );
          })
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
