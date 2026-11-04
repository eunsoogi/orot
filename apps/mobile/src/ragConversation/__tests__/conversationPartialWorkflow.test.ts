import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';
import { createConversationRetentionBridge } from '../../aiFeatures/integration/conversationRetentionBridge';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';

test('a validated partial model response reaches the screen and SQLite', async () => {
  const db = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(db.database);
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `id-${++sequence}`,
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const sessions = createConversationSessions({ retention });
    const model = fixture();
    model.generate.mockReset().mockResolvedValueOnce(
      response({
        type: 'result',
        value: {
          answerKind: 'conversation',
          answer: '한 가지는 함께 살펴볼 수 있어요.',
          completion: 'partial',
        },
        citations: [],
      }),
    );
    sessions.setDraft(1, 'question');
    await sessions.send(
      1,
      async (question, previousMessages, signal, observer) => {
        const bridge = createConversationRetentionBridge({
          observer,
          registry: new LocalEvidenceReferenceRegistry(),
          question,
          providerId: 'provider',
          modelId: 'model',
          signal: signal!,
        });
        const outcome = await runRagConversationTurn(
          {
            ...model.options,
            question,
            previousMessages,
            loadCurrentEvidence: async () => ({
              batch: { items: [], coverage: [], conflicts: [] },
              chunks: [],
            }),
            onValidatedEvidence: bridge.onValidatedEvidence,
          },
          { signal },
        );
        return (await bridge.finish(outcome)).outcome;
      },
    );
    expect(sessions.getSnapshot().sessions[0]?.messages[1]?.completion).toBe(
      'partial',
    );
    expect(await storage.read('id-2')).toMatchObject({
      status: 'partial',
      answer: '한 가지는 함께 살펴볼 수 있어요.',
    });
    sessions.dispose();
  } finally {
    db.close();
  }
});
