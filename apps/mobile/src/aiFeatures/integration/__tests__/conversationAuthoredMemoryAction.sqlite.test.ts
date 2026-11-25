import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../../healthEvidence/localEvidenceTestSupport';
import { saveConversationHealthHistory } from '../../../storage/conversationHealthHistory';
import { conversationAuthoredMemoryAction } from '../conversationAuthoredMemoryAction';
import type { AiFeatureLocalData } from '../localData';

const statement = '라일락 프로젝트의 데모는 매주 금요일이에요.';
const question = `${statement} 앞으로도 이 일정을 잊지 않았으면 해요.`;
const proposal = { statement };

async function fixture({
  allow = true,
  persisted = question,
  version = 4,
}: { allow?: boolean; persisted?: string; version?: number } = {}) {
  const f = createHealthEvidenceTestDatabase();
  await runMigrations(f.database);
  await f.database.execute(
    'CREATE TABLE conversation_artifact_sessions (id TEXT PRIMARY KEY, version INTEGER, hidden INTEGER)',
  );
  await f.database.execute(
    'CREATE TABLE conversation_requests (id TEXT PRIMARY KEY, session_id TEXT, session_version INTEGER, question TEXT, status TEXT)',
  );
  await f.database.execute(
    "INSERT INTO conversation_artifact_sessions VALUES ('session', 4, 0)",
  );
  await f.database.execute(
    "INSERT INTO conversation_requests VALUES ('request', 'session', 4, ?, 'active')",
    [persisted],
  );
  const confirmHistorySave = jest.fn(async () => allow);
  const save = jest.fn(
    (
      input: Parameters<typeof saveConversationHealthHistory>[1],
      signal: AbortSignal,
    ) => saveConversationHealthHistory(f.database, input, signal),
  );
  let current = true;
  const observer = {
    inputOrigin: 'composer' as const,
    retentionSession: { id: 'session', version },
    retentionRequestId: 'request',
    expectedConversationModel: {
      providerId: 'apple',
      modelId: 'synthetic',
      isCurrent: () => current,
    },
    confirmHistorySave,
  };
  const data = {
    saveConversationHistory: save,
  } as unknown as AiFeatureLocalData;
  const boundary = () =>
    conversationAuthoredMemoryAction({ data, observer, question });
  return {
    ...f,
    confirmHistorySave,
    save,
    observer,
    data,
    boundary,
    retire: () => {
      current = false;
    },
    notes: createManualHistoryRepository(f.database),
  };
}

function invocation(signal: AbortSignal, input: unknown = proposal) {
  return { input, signal } as Parameters<
    ReturnType<
      typeof conversationAuthoredMemoryAction
    >['actions'][number]['execute']
  >[0];
}

it('uses one exact reviewed authored statement and never returns the note as evidence', async () => {
  const f = await fixture();
  try {
    const {
      actions: [tool],
      receipt,
    } = f.boundary();
    const signal = new AbortController().signal;
    expect(tool.parseInput(proposal)).toEqual(proposal);
    expect(await tool.authorize?.(proposal, signal)).toBe(true);
    expect(f.confirmHistorySave).toHaveBeenCalledWith(statement, signal);
    await expect(tool.execute(invocation(signal))).resolves.toEqual({
      items: [],
      coverage: [],
      conflicts: [],
    });
    expect(receipt()).toBe('saved');
    expect((await f.notes.list()).map(note => note.details)).toEqual([
      statement,
    ]);
    expect(await f.notes.listEvidence()).toEqual([]);
    await expect(tool.execute(invocation(signal))).rejects.toThrow();
    expect(f.save).toHaveBeenCalledTimes(1);
  } finally {
    f.close();
  }
});

it.each(['decline', 'stale', 'changed', 'retired', 'substituted'] as const)(
  'does not commit a note after %s',
  async mode => {
    const f = await fixture({
      allow: mode !== 'decline',
      persisted:
        mode === 'changed' ? 'Unrelated currently stored text.' : question,
      version: mode === 'stale' ? 3 : 4,
    });
    try {
      const {
        actions: [tool],
        receipt,
      } = f.boundary();
      const signal = new AbortController().signal;
      expect(await tool.authorize?.(proposal, signal)).toBe(mode !== 'decline');
      if (mode === 'retired') f.retire();
      const value =
        mode === 'substituted'
          ? { statement: '앞으로도 이 일정을 잊지 않았으면 해요.' }
          : proposal;
      await expect(tool.execute(invocation(signal, value))).rejects.toThrow();
      expect(receipt()).toBe('not_saved');
      expect(await f.notes.list()).toEqual([]);
    } finally {
      f.close();
    }
  },
);

it('offers no canned-shortcut action and refuses fabricated, repeated, quoted or secret input', async () => {
  const f = await fixture();
  try {
    const actionsFor = (
      text: string,
      inputOrigin: 'composer' | 'shortcut' = 'composer',
    ) =>
      conversationAuthoredMemoryAction({
        data: f.data,
        observer: { ...f.observer, inputOrigin },
        question: text,
      }).actions;
    expect(actionsFor(question, 'shortcut')).toEqual([]);
    expect(
      actionsFor(question)[0].parseInput({ statement: statement.slice(0, -1) }),
    ).toBeUndefined();
    for (const text of [
      `${statement} ${statement}`,
      `“${statement}” ${question}`,
      `${question} 비밀번호 값은 합성값이에요.`,
      `취소된 계획: ${statement}`,
      `2026-11-25 18:30: ${statement}`,
      `기억하지 마: ${statement}`,
      `API key: ${statement}`,
      `https://example.test: ${statement}`,
      `기억해줘: 취소된 계획: ${statement}`,
      `기억해줘: ${statement} 보관하지 마세요.`,
      `기억해줘: “${statement}”`,
      `기억해줘: ${statement} ${statement}`,
      `과거 건강 기록으로 저장해: ${statement}`,
      `save as past health history: ${statement}`,
    ])
      expect(actionsFor(text)[0].parseInput(proposal)).toBeUndefined();
    expect(f.confirmHistorySave).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});

it.each([
  'valid',
  'valid-control-label',
  'wrong-owner',
  'inactive-return',
] as const)(
  'strict on-device explicit composer uses only its bound local owner: %s',
  async mode => {
    const original =
      mode === 'valid-control-label' ? `기억해줘: ${statement}` : question;
    const succeeds = mode === 'valid' || mode === 'valid-control-label';
    const f = await fixture({ persisted: original });
    try {
      let retire: () => void = () => {};
      const unwatch = jest.fn();
      if (mode === 'inactive-return')
        f.confirmHistorySave.mockImplementationOnce(async () => {
          retire();
          return true;
        });
      const signal = new AbortController().signal;
      const { actions, receipt } = conversationAuthoredMemoryAction({
        data: f.data,
        question: original,
        observer: {
          ...f.observer,
          protectedLocalInput: true,
          expectedConversationModel: {
            providerId: APPLE_PROVIDER_ID,
            modelId: 'synthetic',
          },
          templateProposalOwner: {
            providerId: APPLE_PROVIDER_ID,
            modelId: mode === 'wrong-owner' ? 'other' : 'synthetic',
            current: () => true,
            recheck: async () => true,
            watch(listener) {
              retire = listener;
              return unwatch;
            },
          },
        },
      });
      if (mode === 'wrong-owner') {
        expect(actions).toEqual([]);
        expect(f.confirmHistorySave).not.toHaveBeenCalled();
      } else {
        const [tool] = actions;
        expect(tool.parseInput({ statement: '그래 그럼' })).toBeUndefined();
        expect(await tool.authorize(proposal, signal)).toBe(succeeds);
        if (succeeds) {
          expect(f.confirmHistorySave).toHaveBeenCalledWith(statement, signal);
          await tool.execute(invocation(signal));
        }
        expect(unwatch).toHaveBeenCalledTimes(1);
      }
      expect(receipt()).toBe(
        succeeds
          ? 'saved'
          : mode === 'wrong-owner'
            ? 'not_attempted'
            : 'not_saved',
      );
      expect((await f.notes.list()).map(note => note.details)).toEqual(
        succeeds ? [statement] : [],
      );
    } finally {
      f.close();
    }
  },
);
