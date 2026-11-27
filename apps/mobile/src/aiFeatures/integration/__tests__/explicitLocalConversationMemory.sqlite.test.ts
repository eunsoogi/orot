import { createConversationSummaryIntegration } from '../conversationSummaryIntegration';
import { createAgentMemory, listSavedMemories } from '@orot/agent-memory';
import {
  createManualHistoryRepository,
  isLocalConversationMemoryId,
  runMigrations,
} from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../../healthEvidence/localEvidenceTestSupport';
import { processStatementMemoryJobs } from '../../../memory/userStatementMemoryProcessing';
import { SqlCipherAgentMemoryStorage } from '../../../storage/agentMemoryStorage';
import { saveConversationHealthHistory } from '../../../storage/conversationHealthHistory';
import type { AiFeatureLocalData } from '../localData';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { buildMemoryEvidence } from '../memoryEvidence';
import { trySaveExplicitConversationMemory } from '../saveExplicitConversationMemory';
import { conversationHistoryPayload } from '../../../ragConversation/conversationHistoryPayload';

// Exact existing native owner remains independently owned by other tests. The
// explicit local route must not reach it or either generation entry point.
jest.mock('../conversationNativeSelectionWitness', () => ({
  captureNativeConversationSelectionWitness: jest.fn(),
}));

const question = '기억해 줘: 라일락 프로젝트의 데모는 매주 금요일이에요.';
const note = '라일락 프로젝트의 데모는 매주 금요일이에요.';
const observer = {
  inputOrigin: 'composer' as const,
  retentionSession: { id: 'synthetic-session', version: 4 },
  retentionRequestId: 'synthetic-request',
};
const signal = new AbortController().signal;

async function setup() {
  const f = createHealthEvidenceTestDatabase();
  await runMigrations(f.database);
  await f.database.execute(
    'CREATE TABLE conversation_artifact_sessions (id TEXT PRIMARY KEY, version INTEGER, hidden INTEGER)',
  );
  await f.database.execute(
    'CREATE TABLE conversation_requests (id TEXT PRIMARY KEY, session_id TEXT, session_version INTEGER, question TEXT, status TEXT)',
  );
  await f.database.execute(
    'INSERT INTO conversation_artifact_sessions VALUES (?, 4, 0)',
    [observer.retentionSession.id],
  );
  await f.database.execute(
    "INSERT INTO conversation_requests VALUES (?, ?, 4, ?, 'active')",
    [observer.retentionRequestId, observer.retentionSession.id, question],
  );
  const save = jest.fn((input, active: AbortSignal) =>
    saveConversationHealthHistory(f.database, input, active),
  );
  const load = jest.fn(
    async () =>
      ({ saveConversationHistory: save }) as unknown as AiFeatureLocalData,
  );
  return { ...f, load, save };
}

it('saves an ordinary typed memory once, reopens and recalls locally, and excludes its text and corrections from evidence', async () => {
  const f = await setup();
  const run = () =>
    trySaveExplicitConversationMemory(question, observer, f.load, signal);
  try {
    expect(await run()).toEqual({
      status: 'answer',
      answer: '이 기기의 기억에 저장했어요.',
      citations: [],
    });
    expect((await run())?.status).toBe('answer');
    const notes = createManualHistoryRepository(f.database);
    const reopened = createManualHistoryRepository(f.database);
    const [saved] = await reopened.list({ search: '라일락' });
    expect(saved.details).toBe(note);
    expect(isLocalConversationMemoryId(saved.id)).toBe(true);
    expect(await notes.listEvidence()).toEqual([]);
    expect(await notes.getEvidence(saved.id)).toBeNull();
    const storage = new SqlCipherAgentMemoryStorage(f.database);
    const memory = await createAgentMemory({
      storage,
      embedder: {
        embed: async texts => texts.map(() => new Float32Array([1, 0])),
      },
    });
    await processStatementMemoryJobs(f.database, memory);
    expect((await memory.recall('라일락')).map(record => record.text)).toEqual([
      expect.stringContaining(note),
    ]);
    const records = await storage.listRecords();
    expect(
      (
        await buildMemoryEvidence({
          records,
          storage,
          registry: new LocalEvidenceReferenceRegistry(),
        })
      ).items,
    ).toEqual([]);
    expect(
      await listSavedMemories(new SqlCipherAgentMemoryStorage(f.database)),
    ).toHaveLength(1);
    const corrected = await notes.correct(saved.id, {
      kind: 'note',
      title: 'Corrected',
      details: 'A new local plan.',
      effectiveDate: { status: 'unknown' },
    });
    expect(isLocalConversationMemoryId(corrected.id)).toBe(true);
    expect(await notes.listEvidence()).toEqual([]);
    expect(await notes.delete(corrected.id)).toBe(true);
    expect(await notes.list()).toEqual([]);
    await expect(run()).resolves.toEqual({
      status: 'failure',
      kind: 'unavailable',
    });
    expect(await listSavedMemories(storage)).toEqual([]);
    await memory.close();
  } finally {
    f.close();
  }
});

it('refuses explicit secret, deferred pointer or hypothetical payload locally without opening storage', async () => {
  const load = jest.fn();
  for (const text of [
    'Remember that my password is synthetic-only.',
    '이 보고서 기억해 줘.',
    '기억해: 만약 이 프로젝트가 생긴다면 금요일이에요.',
  ]) {
    expect(
      await trySaveExplicitConversationMemory(text, observer, load, signal),
    ).toMatchObject({
      status: 'answer',
      answer: expect.stringContaining('저장하지 않았어요'),
    });
  }
  expect(load).not.toHaveBeenCalled();
  expect(
    await trySaveExplicitConversationMemory(
      question,
      { ...observer, inputOrigin: 'shortcut' },
      load,
      signal,
    ),
  ).toBeUndefined();
  expect(
    conversationHistoryPayload(
      [{ id: 1, role: 'user', content: question }],
      '',
    ),
  ).toEqual([]);
});

it('a stale durable request cannot write or send a success receipt', async () => {
  const f = await setup();
  try {
    expect(
      await trySaveExplicitConversationMemory(
        question,
        {
          ...observer,
          retentionSession: { ...observer.retentionSession, version: 3 },
        },
        f.load,
        signal,
      ),
    ).toEqual({ status: 'failure', kind: 'unavailable' });
    expect(await createManualHistoryRepository(f.database).list()).toEqual([]);
  } finally {
    f.close();
  }
});

it('a previously local-only typed summary never sends or falsely claims a save', async () => {
  const f = await setup();
  const downstream = jest.fn();
  const select = jest.fn();
  const authorize = jest.fn();
  try {
    const { sendRagMessage } = createConversationSummaryIntegration({
      consent: { authorize },
      dependencies: {},
      loadData: f.load,
      selectedAi: select,
      registry: new LocalEvidenceReferenceRegistry(),
      diseaseRunner: downstream,
      sendRagMessage: downstream,
      loadSavedVisitQuestions: jest.fn(),
    });
    const local = await sendRagMessage(question, [], signal, observer, {
      intent: 'health-summary',
      entryKey: 'synthetic-summary',
    });
    expect(local).toEqual({
      status: 'failure',
      kind: 'protected_memory_not_saved',
      discardUnverifiedDraft: true,
    });
    expect(downstream).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(await createManualHistoryRepository(f.database).list()).toEqual([]);
  } finally {
    f.close();
  }
});

it('cancellation after the final source read but before commit leaves no local entry', async () => {
  const f = await setup();
  const cancel = new AbortController();
  const real = f.database.transaction.bind(f.database);
  let sourceReads = 0;
  jest.spyOn(f.database, 'transaction').mockImplementation(operation =>
    real(tx =>
      operation({
        commit: () => tx.commit(),
        rollback: () => tx.rollback(),
        async execute(sql, parameters) {
          const result = await tx.execute(sql, parameters);
          if (
            sql.startsWith('SELECT r.question, r.status') &&
            ++sourceReads === 2
          )
            cancel.abort();
          return result;
        },
      }),
    ),
  );
  try {
    expect(
      await trySaveExplicitConversationMemory(
        question,
        observer,
        f.load,
        cancel.signal,
      ),
    ).toEqual({ status: 'failure', kind: 'cancelled' });
    expect(sourceReads).toBe(2);
    expect(await createManualHistoryRepository(f.database).list()).toEqual([]);
  } finally {
    f.close();
  }
});
