import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { restoreConversationArtifact } from './restoreConversationArtifact';
import { fingerprint } from './evidenceUtils';

/** Restore each turn with fresh source aliases, and withhold stale or unavailable results. */
export async function restoreConversationSessionPage(input: {
  readonly sessionId: string;
  readonly cursor?: { readonly createdAt: string; readonly id: string };
  readonly limit?: number;
  readonly ids?: readonly string[];
  readonly storage: ReturnType<typeof createConversationArtifactStorage>;
  readonly data: AiFeatureLocalData;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly signal: AbortSignal;
}) {
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
  for (const item of page.items) {
    if (input.signal.aborted)
      throw new Error('Conversation restoration was cancelled.');
    const result = await restoreConversationArtifact({ ...input, id: item.id });
    if (result?.sessionId === input.sessionId) items.push(result);
    else unavailableItems.push({ id: item.id, createdAt: item.createdAt });
  }
  // Recheck the entire page in one transaction against a consistent source snapshot.
  const saved = await input.storage.readMany(items.map(item => item.id));
  for (let index = items.length - 1; index >= 0; index--) {
    if (!saved[index] || fingerprint(saved[index]) !== items[index]!.revision) {
      // A stable withheld row can become a notice, but mid-read changes cancel publication.
      throw new Error('Conversation content changed during restoration.');
    }
  }
  if (input.signal.aborted)
    throw new Error('Conversation restoration was cancelled.');
  return {
    items,
    unavailableItems,
    unavailableCount: unavailableItems.length,
    nextCursor: page.nextCursor,
  };
}
