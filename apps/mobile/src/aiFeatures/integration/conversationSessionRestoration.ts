import { withConversationReadOperation } from './conversationReadOperation';
import type { ConversationCaptureOwner } from './evidenceCaptureBatch';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { restoreConversationArtifact } from './restoreConversationArtifact';
import { fingerprint } from './evidenceUtils';
import { createConversationPageHydration } from './conversationPageHydration';

/** Restore each turn with fresh source aliases, and withhold stale or unavailable results. */
type SessionRestoreInput = {
  readonly sessionId: string;
  readonly cursor?: { readonly createdAt: string; readonly id: string };
  readonly limit?: number;
  readonly ids?: readonly string[];
  readonly storage: ReturnType<typeof createConversationArtifactStorage>;
  readonly data: AiFeatureLocalData;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly signal: AbortSignal;
  readonly readOperation?: ReturnType<
    SessionRestoreInput['storage']['beginReadOperation']
  >;
  readonly boundCaptureOwner?: ConversationCaptureOwner;
};

export async function restoreConversationSessionPage(
  input: SessionRestoreInput,
) {
  const operation =
    input.readOperation ?? input.storage.beginReadOperation?.(input.signal);
  try {
    return await withConversationReadOperation(
      input.data,
      data => restore({ ...input, data, reads: operation ?? input.storage }),
      input.signal,
      operation?.healthContextReportScope,
    );
  } finally {
    if (!input.readOperation) operation?.dispose();
  }
}

async function restore(
  input: SessionRestoreInput & {
    reads: Pick<
      SessionRestoreInput['storage'],
      'readMany' | 'readManyWithAncestry'
    >;
  },
) {
  if (input.signal.aborted)
    throw new Error('Conversation restoration was cancelled.');
  const page = await input.storage.list(
    input.sessionId,
    input.cursor,
    input.limit,
    'conversation',
    input.ids,
  );
  const items: NonNullable<
    Awaited<ReturnType<typeof restoreConversationArtifact>>
  >[] = [];
  const unavailableItems: { id: string; createdAt: string }[] = [];
  // One transaction shares identical period calculations while still checking each
  // root's deletion, parent, policy and source guards independently.
  const snapshots = await input.reads.readManyWithAncestry(
    page.items.map(item => item.id),
  );
  const hydrate = createConversationPageHydration(input, snapshots.ancestry);
  for (const [index, item] of page.items.entries()) {
    if (input.signal.aborted)
      throw new Error('Conversation restoration was cancelled.');
    const snapshot = snapshots.items[index];
    if (
      snapshot &&
      fingerprint(snapshots.ancestry.get(item.id)) !== fingerprint(snapshot)
    )
      throw new Error('Conversation ancestry changed during restoration.');
    const result = snapshot ? await hydrate(item.id) : null;
    if (result?.sessionId === input.sessionId) items.push(result);
    else unavailableItems.push({ id: item.id, createdAt: item.createdAt });
  }
  // Recheck the entire page in one transaction against a consistent source snapshot.
  const saved = await input.reads.readMany(items.map(item => item.id));
  for (let index = items.length - 1; index >= 0; index--) {
    if (!saved[index] || fingerprint(saved[index]) !== items[index]!.revision) {
      // A stable withheld row can become a notice, but mid-read changes cancel publication.
      throw new Error('Conversation content changed during restoration.');
    }
  }
  // A null initial snapshot can mean either stable quarantine or a row removed
  // after listing. Recheck metadata too, including hidden sessions and unavailable rows.
  const latestPage = await input.storage.list(
    input.sessionId,
    input.cursor,
    input.limit,
    'conversation',
    input.ids,
  );
  if (fingerprint(latestPage) !== fingerprint(page))
    throw new Error('Conversation content changed during restoration.');
  if (input.signal.aborted)
    throw new Error('Conversation restoration was cancelled.');
  return {
    items,
    unavailableItems,
    unavailableCount: unavailableItems.length,
    nextCursor: page.nextCursor,
  };
}
