import { waitFor } from '@testing-library/react-native';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { restoreConversationTaskCards } from '../../aiFeatures/integration/restoreConversationTaskCards';
import { commitHealthKitChanges } from '../../healthkit/commitHealthKitChanges';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';
import { produceTreatmentRequest } from '../../treatmentContext/treatmentRequestProducer';
import type { TreatmentExplanationRequest } from '../../treatmentContext/interfaces';

test('health deletion reloads surviving treatment cards without interrupting an active conversation', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('saved', await storage.currentGeneration());
    const request = {
      context: {
        version: 1,
        conditions: [],
        clinicianPlans: { status: 'unavailable' },
        publicEvidence: [],
        missingContext: [],
        conflicts: [],
      },
      sources: [],
      revalidateEvidence: async () => true,
    } as unknown as TreatmentExplanationRequest;
    for (const id of ['affected', 'unrelated']) {
      expect(
        await produceTreatmentRequest(
          f.database,
          { kind: 'request', selection: { kind: 'general_options' } },
          request,
          new AbortController().signal,
          [],
          {
            id,
            sessionId: 'saved',
            createdAt: '2026-10-05T00:00:00.000Z',
            question: 'Synthetic',
            expectedSessionVersion: 0,
          },
        ),
      ).toMatchObject({ status: 'validated' });
    }
    // Synthetic lineage exercises the same transaction trigger used by saved health-backed artifacts.
    await f.database.execute(
      'INSERT INTO conversation_artifact_sources (artifact_id, record_kind, record_id) VALUES (?, ?, ?)',
      ['affected', 'health_observation', f.inside.id],
    );
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => 'new',
      now: () => new Date().toISOString(),
    });
    const store = createConversationSessions({
      retention,
      restoreSession: async () => [],
      restoreTasks: (id, signal) =>
        restoreConversationTaskCards(storage, id, signal),
    });
    const id = await store.attachExisting(
      'saved',
      0,
      '2026-10-05T00:00:00.000Z',
    );
    expect(
      store.getSnapshot().sessions.find(item => item.id === id)?.taskCards,
    ).toHaveLength(2);
    let finish!: (result: { status: 'no_evidence' }) => void;
    let signal: AbortSignal | undefined;
    store.setDraft(id, 'question');
    const running = store.send(id, async (_question, _history, incoming) => {
      signal = incoming;
      return new Promise(resolve => {
        finish = resolve;
      });
    });
    await waitFor(() => expect(signal).toBeDefined());
    store.setDraft(id, 'keep draft');
    await commitHealthKitChanges(f.repository, async writer =>
      Number(await writer.delete('health_observation', f.inside.id)),
    );
    store.refreshAfterSourceDeletion('healthkit', new Set([f.inside.id]));
    await waitFor(() =>
      expect(
        store
          .getSnapshot()
          .sessions.find(item => item.id === id)
          ?.taskCards?.map(card => card.id),
      ).toEqual(['treatment:unrelated']),
    );
    expect(
      store.getSnapshot().sessions.find(item => item.id === id)?.draft,
    ).toBe('keep draft');
    expect(signal?.aborted).toBe(false);
    finish({ status: 'no_evidence' });
    await running;
    expect(await storage.read('affected')).toBeNull();
    expect(await storage.read('unrelated')).not.toBeNull();
    store.dispose();
  } finally {
    f.close();
  }
});
