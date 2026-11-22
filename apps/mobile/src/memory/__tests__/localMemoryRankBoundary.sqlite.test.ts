import {
  AGENT_MEMORY_NAMESPACE,
  createAgentMemory,
  createAgentMemoryStoreView,
  listSavedMemories,
  RememoriLangGraphStore,
} from '@orot/agent-memory';
import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { saveConversationHealthHistory } from '../../storage/conversationHealthHistory';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import {
  providerVisibleAgentMemory,
  providerVisibleMemoryReader,
} from '../providerVisibleMemory';
import {
  enqueueExistingHistoryMemories,
  processStatementMemoryJobs,
} from '../userStatementMemoryProcessing';

test('a high-ranked private note cannot displace an already eligible result or become visible', async () => {
  const f = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(f.database);
    await f.database.execute(
      'CREATE TABLE conversation_artifact_sessions (id TEXT PRIMARY KEY, version INTEGER, hidden INTEGER)',
    );
    await f.database.execute(
      'CREATE TABLE conversation_requests (id TEXT PRIMARY KEY, session_id TEXT, session_version INTEGER, question TEXT, status TEXT)',
    );
    const sessionId = 'synthetic-session';
    const requestId = 'synthetic-request';
    const question = '기억해 줘: 라일락 프로젝트 데모는 매주 금요일이에요.';
    await f.database.execute(
      'INSERT INTO conversation_artifact_sessions VALUES (?, 0, 0)',
      [sessionId],
    );
    await f.database.execute(
      "INSERT INTO conversation_requests VALUES (?, ?, 0, ?, 'active')",
      [requestId, sessionId, question],
    );
    const privateId = await saveConversationHealthHistory(
      f.database,
      { requestId, sessionId, sessionVersion: 0, question, localOnly: true },
      new AbortController().signal,
    );
    const publicEligible = await createManualHistoryRepository(
      f.database,
    ).create({
      kind: 'note',
      title: 'Synthetic existing visible history',
      details: '합성 대조군 산책 기록',
      effectiveDate: { status: 'unknown' },
    });
    const storage = new SqlCipherAgentMemoryStorage(f.database);
    // The private note is the genuine top hit; the still-relevant control ranks second.
    const embedder = {
      embed: jest.fn(async (texts: string[]) =>
        texts.map(
          text =>
            new Float32Array(text.includes('대조군') ? [0.95, 0.31] : [1, 0]),
        ),
      ),
    };
    const memory = await createAgentMemory({ storage, embedder });
    try {
      await enqueueExistingHistoryMemories(f.database);
      await processStatementMemoryJobs(f.database, memory);
      const saved = await listSavedMemories(storage);
      const denied = saved.find(row =>
        row.provenance.sourceIds.includes(privateId),
      )!;
      const allowed = saved.find(row =>
        row.provenance.sourceIds.includes(publicEligible.id),
      )!;
      expect(saved).toHaveLength(2);
      const raw = await memory.recall('라일락', { limit: 2 });
      expect(raw.map(hit => hit.id)).toEqual([denied.id, allowed.id]);
      const filtered = providerVisibleMemoryReader(memory);
      const graph = createAgentMemoryStoreView(
        providerVisibleAgentMemory(memory),
        new RememoriLangGraphStore({ storage, embedder }),
      );
      const ns = [...AGENT_MEMORY_NAMESPACE];
      expect(
        (await filtered.recall('라일락', { limit: 1 })).map(hit => hit.id),
      ).toEqual([allowed.id]);
      expect(
        (await filtered.recall('라일락', { limit: 2 })).map(hit => hit.id),
      ).toEqual([allowed.id]);
      expect(
        (await graph.search(ns, { query: '라일락', limit: 1 })).map(
          hit => hit.key,
        ),
      ).toEqual([allowed.memoryKey]);
      expect(
        (await graph.search(ns, { query: '라일락', limit: 2 })).map(
          hit => hit.key,
        ),
      ).toEqual([allowed.memoryKey]);
      for (const limit of [4, 5]) {
        const beforeReader = embedder.embed.mock.calls.length;
        expect(
          (await filtered.recall('라일락', { limit })).map(hit => hit.id),
        ).toEqual([allowed.id]);
        expect(embedder.embed).toHaveBeenCalledTimes(beforeReader + 1);
        const beforeGraph = embedder.embed.mock.calls.length;
        expect(
          (await graph.search(ns, { query: '라일락', limit })).map(
            hit => hit.key,
          ),
        ).toEqual([allowed.memoryKey]);
        expect(embedder.embed).toHaveBeenCalledTimes(beforeGraph + 1);
      }
      expect(await graph.get(ns, denied.memoryKey!)).toBeNull();
      expect(await graph.get(ns, allowed.memoryKey!)).not.toBeNull();
      expect(
        await createManualHistoryRepository(f.database).delete(privateId),
      ).toBe(true);
      expect(
        (await filtered.recall('라일락', { limit: 1 })).map(hit => hit.id),
      ).toEqual([allowed.id]);
    } finally {
      await memory.close();
    }
  } finally {
    f.close();
  }
});
