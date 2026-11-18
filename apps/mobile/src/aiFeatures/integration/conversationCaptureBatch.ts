import { withConversationReadOperation } from './conversationReadOperation';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { ConversationCaptureOwner } from './evidenceCaptureBatch';
import type { EvidenceSourceReadResult } from './evidenceSourceDocument';
import { createConversationPageHydration } from './conversationPageHydration';
import { fingerprint } from './evidenceUtils';
import type { restoreConversationArtifact } from './restoreConversationArtifact';

type Hydrated = NonNullable<
  Awaited<ReturnType<typeof restoreConversationArtifact>>
>;
export function conversationCaptureDetail(saved: Hydrated) {
  return {
    metadata: {
      type: 'conversation_turn' as const,
      id: saved.id,
      originFeature: 'record_conversation',
      originSession: saved.sessionId,
      createdAt: saved.createdAt,
      eventTime: null,
      revision: saved.revision,
      providerId: saved.providerId,
      modelId: saved.modelId,
      completion: saved.status,
      review: 'unreviewed' as const,
    },
    content: { question: saved.question, answer: saved.answer },
    sources: saved.sources,
    sourceStatus: saved.sourceStatus,
  };
}

/** A fresh graph per operation, not a reusable validity cache. Hydration still
 * executes summary/research/native checks; only database ancestry checks share a
 * transaction. Unsupported native/treatment roots retain the complete strict read. */
export function createConversationCaptureOwner(input: {
  storage: ReturnType<typeof createConversationArtifactStorage>;
  data: AiFeatureLocalData;
  registry: LocalEvidenceReferenceRegistry;
  boundCaptureOwner?: ConversationCaptureOwner;
}): ConversationCaptureOwner {
  return {
    registry: input.registry,
    async prepare(requests, signal, reads) {
      if (requests.some(request => request.bound))
        throw new Error('Unexpected bound authority.');
      const sessionsCurrent = async () => {
        for (const request of requests)
          if (
            request.session &&
            (await input.storage.activeSessionVersion(request.session.id)) !==
              request.session.version
          )
            return false;
        return !signal.aborted;
      };
      if (!(await sessionsCurrent()))
        throw new Error('Conversation session changed.');
      const snapshots = await (
        reads?.forStorage(input.storage) ?? input.storage
      ).readManyWithAncestry(requests.map(item => item.id));

      const results: EvidenceSourceReadResult[] = [];
      // If any native-owned ancestor occurs, avoid inferring its freshness from a DB snapshot.
      const strict = [...snapshots.ancestry.values()].some(
        row =>
          row.submittedInput ||
          row.treatmentContext ||
          row.sources.some(
            source => 'kind' in source && source.kind === 'conversation_photo',
          ),
      );
      await withConversationReadOperation(
        input.data,
        async data => {
          const hydrate = createConversationPageHydration(
            { ...input, data, signal },
            snapshots.ancestry,
          );
          for (const [index, request] of requests.entries()) {
            if (signal.aborted) throw new Error('Capture cancelled.');
            const saved = snapshots.items[index];
            if (!saved) {
              results.push({ status: 'missing' });
              continue;
            }
            if (
              fingerprint(saved) !== request.revision ||
              (request.session && saved.sessionId !== request.session.id)
            ) {
              results.push({ status: 'changed' });
              continue;
            }
            if (
              fingerprint(snapshots.ancestry.get(request.id)) !==
              fingerprint(saved)
            )
              throw new Error('Conversation ancestry changed.');
            if (strict) {
              results.push({ status: 'unavailable' });
              continue;
            }
            const restored = await hydrate(request.id).then(value =>
              value ? conversationCaptureDetail(value) : null,
            );
            results.push(
              restored && restored.metadata.revision === request.revision
                ? {
                    status: 'available',
                    document: {
                      sourceKind: 'generated_artifact',
                      metadata: restored.metadata,
                      conversation: restored.content,
                      sources: restored.sources,
                      sourceStatus: restored.sourceStatus,
                    },
                  }
                : { status: 'unavailable' },
            );
          }
        },
        signal,
        reads?.forStorage(input.storage)?.healthContextReportScope,
      );
      return {
        results,
        strict: strict ? requests.map((_, index) => index) : undefined,
        finish: async () => {
          if (signal.aborted || !(await sessionsCurrent())) return false;
          const latest = await (
            reads?.forStorage(input.storage) ?? input.storage
          ).readMany(requests.map(item => item.id));
          return (
            !signal.aborted &&
            latest.every((row, index) =>
              Boolean(row && fingerprint(row) === requests[index]!.revision),
            ) &&
            (await sessionsCurrent())
          );
        },
      };
    },
  };
}
