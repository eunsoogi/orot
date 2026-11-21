import {
  AGENT_MEMORY_NAMESPACE,
  createAgentMemory,
  createAgentMemoryStoreView,
  RememoriLangGraphStore,
  listSavedMemories,
} from '@orot/agent-memory';
import { createLocalRecordQueryService } from '@orot/agent-runtime';
import {
  createLocalRecordQueryRepository,
  createManualHistoryRepository,
  runMigrations,
} from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { saveConversationHealthHistory } from '../../storage/conversationHealthHistory';
import { searchReviewedMemoryFromStore } from '../../agent/visitQuestions/reviewedMemorySearch';
import { mapMemoryHitToVisitQuestionEvidence } from '../../agent/visitQuestions/evidence';
import {
  providerVisibleAgentMemory,
  providerVisibleMemoryReader,
  providerVisiblePersistedMemory,
} from '../providerVisibleMemory';
import {
  enqueueExistingHistoryMemories,
  processStatementMemoryJobs,
} from '../userStatementMemoryProcessing';
import { buildMemoryEvidence } from '../../aiFeatures/integration/memoryEvidence';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';

it('keeps actual explicit local notes and their corrections private without affecting normal reviewed evidence', async () => {
  const f = createHealthEvidenceTestDatabase();
  const sessionId = 'synthetic-session';
  const requestId = 'synthetic-request';
  const phrase = '라일락 프로젝트의 데모는 매주 금요일이에요.';
  const question = '기억해 줘: ' + phrase;
  await runMigrations(f.database);
  await f.database.execute(
    'CREATE TABLE conversation_artifact_sessions (id TEXT PRIMARY KEY, version INTEGER, hidden INTEGER)',
  );
  await f.database.execute(
    'CREATE TABLE conversation_requests (id TEXT PRIMARY KEY, session_id TEXT, session_version INTEGER, question TEXT, status TEXT)',
  );
  await f.database.execute(
    'INSERT INTO conversation_artifact_sessions VALUES (?, 0, 0)',
    [sessionId],
  );
  await f.database.execute(
    "INSERT INTO conversation_requests VALUES (?, ?, 0, ?, 'active')",
    [requestId, sessionId, question],
  );
  const source = await saveConversationHealthHistory(
    f.database,
    { requestId, sessionId, sessionVersion: 0, question, localOnly: true },
    new AbortController().signal,
  );
  const storage = new SqlCipherAgentMemoryStorage(f.database);
  const embedder = {
    embed: async (texts: string[]) => texts.map(() => new Float32Array([1, 0])),
  };
  const memory = await createAgentMemory({ storage, embedder });
  const notes = createManualHistoryRepository(f.database);
  try {
    await processStatementMemoryJobs(f.database, memory);
    const [item] = await listSavedMemories(storage);
    expect(item.memoryKey).toBe('manual-history-memory:' + source);
    expect((await notes.list({ search: '라일락' }))[0].details).toBe(phrase);
    const backing = new RememoriLangGraphStore({ storage, embedder });
    const legacy = createAgentMemoryStoreView(memory, backing);
    const namespace = [...AGENT_MEMORY_NAMESPACE];
    expect(
      (await legacy.search(namespace, { query: '라일락' }))[0].value.text,
    ).toContain(phrase);
    expect(
      (await legacy.get(namespace, item.memoryKey!))?.value.text,
    ).toContain(phrase);
    expect(
      (await legacy.search(namespace, { filter: { id: item.id } }))[0].value
        .text,
    ).toContain(phrase);
    const graph = createAgentMemoryStoreView(
      providerVisibleAgentMemory(memory),
      backing,
    );
    const assertPrivate = async (
      privateId: string,
      memoryKey: string,
      query: string,
    ) => {
      expect(await graph.search(namespace, { query })).toEqual([]);
      expect(
        await graph.search(namespace, { filter: { id: privateId } }),
      ).toEqual([]);
      expect(await graph.get(namespace, memoryKey)).toBeNull();
      expect(
        (await searchReviewedMemoryFromStore(legacy, query, 5)).hits,
      ).toEqual([]);
      const repo = createLocalRecordQueryRepository(f.database);
      const [raw] = (
        await createLocalRecordQueryService(repo, memory).searchMemory(query)
      ).hits;
      expect(mapMemoryHitToVisitQuestionEvidence(raw)).toBeNull();
      expect(
        (
          await createLocalRecordQueryService(
            repo,
            providerVisibleMemoryReader(memory),
          ).searchMemory(query)
        ).hits,
      ).toEqual([]);
      const records = await storage.listRecords();
      expect(records.filter(providerVisiblePersistedMemory)).toEqual([]);
      expect(
        (
          await buildMemoryEvidence({
            records,
            storage,
            registry: new LocalEvidenceReferenceRegistry(),
          })
        ).items,
      ).toEqual([]);
    };
    await assertPrivate(item.id, item.memoryKey!, '라일락');
    const corrected = await notes.correct(source, {
      kind: 'note',
      title: 'Local correction',
      details: '라일락은 이제 목요일에 진행해요.',
      effectiveDate: { status: 'unknown' },
    });
    await enqueueExistingHistoryMemories(f.database);
    await processStatementMemoryJobs(f.database, memory);
    const [replacement] = await listSavedMemories(storage);
    expect(replacement.provenance.sourceIds).toEqual([corrected.id]);
    await assertPrivate(replacement.id, replacement.memoryKey!, '목요일');
    expect(await notes.delete(corrected.id)).toBe(true);
    expect(await listSavedMemories(storage)).toEqual([]);
    const health = await notes.create({
      kind: 'note',
      title: 'Synthetic control',
      details: '합성 운동 기록',
      effectiveDate: { status: 'unknown' },
    });
    await enqueueExistingHistoryMemories(f.database);
    await processStatementMemoryJobs(f.database, memory);
    const [normal] = await listSavedMemories(storage);
    expect(normal.provenance.sourceIds).toEqual([health.id]);
    expect(await graph.get(namespace, normal.memoryKey!)).toBeTruthy();
    const [persisted] = await storage.listRecords();
    const legacyWithoutKey = {
      ...persisted,
      meta: { ...persisted.meta, memoryKey: undefined },
    };
    const malformedKey = {
      ...persisted,
      meta: { ...persisted.meta, memoryKey: 123 },
    };
    expect(providerVisiblePersistedMemory(legacyWithoutKey)).toBe(true);
    expect(providerVisiblePersistedMemory(malformedKey)).toBe(false);
    expect(
      (
        await buildMemoryEvidence({
          records: [malformedKey],
          storage,
          registry: new LocalEvidenceReferenceRegistry(),
        })
      ).items,
    ).toEqual([]);
  } finally {
    await memory.close();
    f.close();
  }
});
