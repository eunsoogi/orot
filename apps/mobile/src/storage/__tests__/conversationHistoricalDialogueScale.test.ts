import type { JsonObject } from '@orot/model-runtime';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { createColdPromptDialogueGuard } from '../../aiFeatures/integration/coldPromptDialogue';
import { readColdRagCompletion } from '../../aiFeatures/integration/coldRagCompletion';
import { localData } from '../../aiFeatures/integration/featureServiceFixtures';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import type { ConversationArtifact } from '../conversationArtifactTypes';

const artifact = (id: string): ConversationArtifact => ({
  id,
  sessionId: 'session',
  createdAt: '2026-11-06T00:00:00.000Z',
  question: 'Synthetic question',
  answer: 'Synthetic answer',
  providerId: 'test',
  modelId: 'test',
  status: 'complete',
  sources: [],
  citations: [],
});

test('more than 128 admitted historical turns retain and re-open without weakening exact ownership', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('session', await storage.currentGeneration());
    const rows = Array.from({ length: 129 }, (_, i) =>
      artifact(`prior-${String(i).padStart(3, '0')}`),
    );
    await f.database.execute(
      `INSERT INTO conversation_artifacts(id, session_id, created_at, result_json)
       SELECT json_extract(value,'$.id'), json_extract(value,'$.sessionId'),
       json_extract(value,'$.createdAt'), value FROM json_each(?)`,
      [JSON.stringify(rows)],
    );
    const signal = new AbortController().signal;
    await expect(
      storage.readProtectedPromptHistory('session', 0, [], signal, false),
    ).resolves.toEqual([]);
    const recent = (await storage.readProtectedPromptHistory(
      'session',
      0,
      [],
      signal,
    ))!;
    expect(recent.map(turn => turn.id)).toEqual(
      rows.slice(-4).map(row => row.id),
    );
    const only = (await storage.readProtectedPromptHistory(
      'session',
      0,
      [rows[0]!.id],
      signal,
    ))!;
    expect(only.map(turn => turn.id)).toEqual([rows[0]!.id]);
    const turns = (await storage.readProtectedPromptHistory(
      'session',
      0,
      rows.map(row => row.id),
      signal,
    ))!;
    const parents = turns.map(({ id, createdAt }) => ({ id, createdAt }));
    expect(parents).toHaveLength(129);
    const priorDialogue = turns.map(({ question, answer }) => ({
      question,
      answer,
    }));
    const completion = {
      version: 2,
      historicalDialogueParents: parents,
      entryContext: null,
      priorDialogue,
      priorUserReports: [],
      historySources: [],
      reportReferences: [],
      localRetrievalFailed: false,
    };
    const data = {
      ...localData([]).data,
      openConversationArtifactStorage: async () => storage,
    };
    const guard = await createColdPromptDialogueGuard(completion, data, {
      id: 'session',
      version: 0,
    });
    const registry = new LocalEvidenceReferenceRegistry();
    const read = () =>
      readColdRagCompletion(
        { completion } as unknown as JsonObject,
        registry,
        signal,
        guard,
      );
    expect((await read()).historicalDialogueParents).toEqual(parents);
    await storage.append({
      ...artifact('all-eligible'),
      priorDialogue,
      historicalDialogueParents: parents,
    });
    expect(
      (await storage.read('all-eligible'))?.historicalDialogueParents,
    ).toEqual(parents);
    await f.database.execute(
      "DELETE FROM conversation_artifacts WHERE id='prior-012'",
    );
    await expect(read()).rejects.toThrow('Cold dialogue ownership changed.');
    await expect(storage.read('all-eligible')).resolves.toBeNull();
  } finally {
    f.close();
  }
});
