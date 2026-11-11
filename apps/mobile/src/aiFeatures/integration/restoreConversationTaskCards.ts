import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { RetainedConversationTask } from '../../ragConversation/conversationTaskState';
import { fingerprint } from './evidenceUtils';

/** Legacy treatment artifacts gain reference cards without copying or trusting their contents. */
export async function restoreConversationTaskCards(
  storage: ReturnType<typeof createConversationArtifactStorage>,
  sessionId: string,
  signal: AbortSignal,
) {
  const version = await storage.activeSessionVersion(sessionId);
  if (version === null || signal.aborted)
    throw new Error('Conversation is unavailable.');
  const retained = await storage.readTaskCards(sessionId, version);
  const cards: RetainedConversationTask[] = [...retained];
  const known = new Set(cards.map(card => card.id));
  const listTreatment = async () => {
    const items: { readonly id: string; readonly createdAt: string }[] = [];
    let cursor: { readonly createdAt: string; readonly id: string } | undefined;
    do {
      const page = await storage.list(sessionId, cursor, 50, 'treatment');
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor && !signal.aborted);
    return items;
  };
  const treatment = await listTreatment();
  const legacy = treatment.filter(item => !known.has(`treatment:${item.id}`));
  const legacyArtifacts = await storage.readSessionMany(
    sessionId,
    version,
    legacy.map(item => item.id),
  );
  for (const [index, item] of legacy.entries()) {
    const id = `treatment:${item.id}`;
    const artifact = legacyArtifacts[index];
    if (!artifact?.treatmentContext) continue;
    cards.push({
      id,
      createdAt: item.createdAt,
      revision: 1,
      task: {
        kind: 'treatment',
        artifactId: item.id,
        artifactRevision: fingerprint(artifact),
      },
    });
  }
  if (
    signal.aborted ||
    (await storage.activeSessionVersion(sessionId)) !== version ||
    JSON.stringify(await storage.readTaskCards(sessionId, version)) !==
      JSON.stringify(retained) ||
    JSON.stringify(await listTreatment()) !== JSON.stringify(treatment) ||
    signal.aborted ||
    (await storage.activeSessionVersion(sessionId)) !== version
  )
    throw new Error('Conversation changed during restoration.');
  return cards.sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}
