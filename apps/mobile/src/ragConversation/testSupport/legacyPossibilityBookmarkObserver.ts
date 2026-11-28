import type { SqlDatabase } from '@orot/storage';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { RagConversationObserver } from '../conversationObserver';

/** Write a real historical artifact envelope with no typed bookmark receipt. */
export function legacyPossibilityBookmarkObserver(
  observer: RagConversationObserver,
) {
  return {
    ...observer,
    onRetentionCandidate(candidate, signal) {
      const { possibilityOriginal, ...legacy } = candidate;
      expect(possibilityOriginal?.version).toBe(1);
      return observer.onRetentionCandidate!(legacy, signal);
    },
  } satisfies RagConversationObserver;
}

export async function initializePossibilityBookmarkStorage(
  database: SqlDatabase,
) {
  const storage = createConversationArtifactStorage(
    database,
    candidate => candidate === database,
  );
  await storage.createSession('selected', await storage.currentGeneration());
  return storage;
}
