import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';

export const committedVisitNeighbor = {
  id: 'synthetic-committed-neighbor',
  prompt: 'Nearby retained synthetic question',
  opening: 'Nearby retained synthetic opening',
};

export async function seedCommittedVisitNeighbor(
  storage: ReturnType<typeof createConversationArtifactStorage>,
  at: string,
) {
  const [owner] = (await storage.listSessions()).items;
  if (!owner) throw new Error('Synthetic request owner is unavailable.');
  const request = {
    id: committedVisitNeighbor.id,
    sessionId: owner.id,
    sessionVersion: owner.version,
    question: committedVisitNeighbor.prompt,
    createdAt: at,
  };
  await storage.startRequest(request);
  await storage.completeLocalClarification({
    ...request,
    version: owner.version,
    display: {
      initialResponse: {
        callId: 'neighbor',
        text: committedVisitNeighbor.opening,
      },
    },
    current: () => true,
    signal: new AbortController().signal,
  });
}
