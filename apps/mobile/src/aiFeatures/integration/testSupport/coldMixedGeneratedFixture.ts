import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { coldResearchRegistryFixture } from './coldResearchRegistryFixture';
import { fingerprint } from '../evidenceUtils';
import type { SavedGeneratedConversationSource } from '../../../diseaseHypotheses/savedSummaries';
import type { ConversationArtifactSource } from '../../../ragConversation/conversationArtifactSources';
/** Real SQLite mixed lineage; discovery must not rebuild aliases in an abandoned registry. */
export async function coldMixedGeneratedFixture() {
  const f = await coldResearchRegistryFixture();
  try {
    const storage = createConversationArtifactStorage(f.db.database);
    await storage.createSession(
      'synthetic-session',
      await storage.currentGeneration(),
    );
    await storage.append({
      id: 'synthetic-conversation',
      sessionId: 'synthetic-session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      question: 'Synthetic question',
      answer: 'Synthetic saved answer',
      sources: [f.child],
      citations: [f.child.reference],
    });
    const saved = (await storage.read('synthetic-conversation'))!;
    const revision = fingerprint(saved);
    const conversation: SavedGeneratedConversationSource = {
      kind: 'generated_conversation',
      id: saved.id,
      revision,
      reference: {
        ...f.child.reference,
        sourceId: saved.id,
        evidenceId: saved.id,
        sourceRevision: revision,
        evidenceRevision: revision,
        locator: { kind: 'generated_artifact', type: 'conversation_turn' },
      },
    };
    const alias = f.original.add({
      reference: conversation.reference,
      content: '',
      validate: async () => true,
      readSource: async () => ({ status: 'unavailable' }),
    });
    const data = {
      ...f.data,
      openConversationArtifactStorage: async () => storage,
      conversationArtifactDiscovery: jest.fn(async () => {
        throw new Error('Catalog must not restore aliases');
      }),
    };
    const input = {
      ...f.input,
      snapshot: f.original.snapshot(),
      data,
      sources: [
        f.parent,
        f.child,
        conversation,
      ] as readonly ConversationArtifactSource[],
    };
    return {
      ...f,
      researchStorage: f.storage,
      storage,
      conversation,
      alias,
      data,
      input,
    };
  } catch (error) {
    f.db.close();
    throw error;
  }
}
