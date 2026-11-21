import { createAgentMemory, listSavedMemories } from '@orot/agent-memory';
import { createLocalRecordQueryService } from '@orot/agent-runtime';
import {
  createLocalRecordQueryRepository,
  localConversationMemoryIdPrefix,
  runMigrations,
} from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import {
  providerVisibleMemoryReader,
  providerVisiblePersistedMemory,
  providerVisibleAgentMemory,
} from '../providerVisibleMemory';
import { mapMemoryHitToVisitQuestionEvidence } from '../../agent/visitQuestions/evidence';

it('rejects an exact private durable key even if migrated provenance looks reviewed and unrelated', async () => {
  const f = createHealthEvidenceTestDatabase();
  const storage = new SqlCipherAgentMemoryStorage(f.database);
  const embedder = {
    embed: async (texts: string[]) => texts.map(() => new Float32Array([1, 0])),
  };
  const memoryKey =
    'manual-history-memory:' +
    localConversationMemoryIdPrefix +
    'synthetic-key';
  const marker = 'Synthetic private note should stay local';
  await runMigrations(f.database);
  let memory = await createAgentMemory({ storage, embedder });
  try {
    await memory.remember({
      memoryKey,
      text: marker,
      kind: 'reviewed_interaction',
      provenance: {
        sourceIds: ['synthetic-other-source'],
        reviewState: 'human_reviewed',
      },
    });
    await memory.close();
    memory = await createAgentMemory({ storage, embedder });
    expect(
      (await storage.listRecords()).filter(providerVisiblePersistedMemory),
    ).toEqual([]);
    expect((await listSavedMemories(storage))[0].text).toBe(marker);
    expect(
      await providerVisibleAgentMemory(memory).getByKey(memoryKey),
    ).toBeNull();
    const repo = createLocalRecordQueryRepository(f.database);
    const raw = await createLocalRecordQueryService(repo, memory).searchMemory(
      marker,
    );
    expect(raw.hits[0]).toMatchObject({ memoryKey, text: marker });
    const guarded = await createLocalRecordQueryService(
      repo,
      providerVisibleMemoryReader(memory),
    ).searchMemory(marker);
    expect({
      genericHits: guarded.hits.map(hit => hit.text),
      visitItems: raw.hits.map(
        hit => mapMemoryHitToVisitQuestionEvidence(hit)?.item.content ?? null,
      ),
    }).toEqual({ genericHits: [], visitItems: [null] });
  } finally {
    await memory.close();
    f.close();
  }
});
