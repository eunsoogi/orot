import { conversationHistoryAction } from '../conversationHistoryAction';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import type { AiFeatureLocalData } from '../localData';

function fixture(
  question = '그 내용을 건강 기록에 저장해줘',
  prior?: string[],
) {
  const saveConversationHistory = jest.fn(async () => 'saved');
  const confirmHistorySave = jest.fn(async () => true);
  const source = '몇 년 전 수술을 받았던 것 같아요.';
  const entry = {
    id: 'evidence',
    sourceEntryId: 'saved',
    kind: 'note',
    text: source,
    effectiveDate: { status: 'unknown' },
    recordedAt: '2026-11-14T00:00:00Z',
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  };
  const data = {
    saveConversationHistory,
    manualHistory: { getEvidence: async () => entry },
  } as unknown as AiFeatureLocalData;
  const observer = {
    retentionSession: { id: 'session', version: 1 },
    retentionRequestId: 'request',
    retainedHistory: (prior ?? [source]).map((question, i) => ({
      id: i ? `prior-${i}` : 'prior',
      question,
    })),
    confirmHistorySave,
  };
  const [action] = conversationHistoryAction({
    data,
    observer,
    registry: new LocalEvidenceReferenceRegistry(),
    question,
    admittedQuestions: prior ?? [source],
  });
  return { action, source, confirmHistorySave, saveConversationHistory };
}
const signal = new AbortController().signal;
const request = (input: { userMessage: string }) => ({
  input,
  signal,
  operationRunId: 'run',
  operationKey: 'tool:1',
});

test('model selection of an admitted prior user message saves only after local confirmation', async () => {
  const { action, source, confirmHistorySave, saveConversationHistory } =
    fixture();
  const input = { userMessage: source };
  expect(action.parseInput(input)).toEqual(input);
  expect(await action.authorize(input, signal)).toBe(true);
  expect(confirmHistorySave).toHaveBeenCalledWith(source, signal);
  expect((await action.execute(request(input))).items).toHaveLength(1);
  expect(saveConversationHistory).toHaveBeenCalledWith(
    expect.objectContaining({
      requestId: 'request',
      approvedSource: { requestId: 'prior', text: source },
    }),
    signal,
  );
  await expect(action.execute(request(input))).rejects.toThrow(
    'fresh user decision',
  );
});

test('clear current save intent does not ask for a redundant confirmation', async () => {
  const question = '과거 건강 기록으로 저장해: 작년에 수술했어요.';
  const { action, confirmHistorySave, saveConversationHistory } =
    fixture(question);
  const input = { userMessage: question };
  expect(await action.authorize(input, signal)).toBe(true);
  await action.execute(request(input));
  expect(confirmHistorySave).not.toHaveBeenCalled();
  expect(saveConversationHistory).toHaveBeenCalledWith(
    expect.objectContaining({
      approvedSource: { requestId: 'request', text: '작년에 수술했어요.' },
    }),
    signal,
  );
});

test('rejects invented text, partial quotes, assistant answers, denial and cancelled grants', async () => {
  const { action, source, confirmHistorySave, saveConversationHistory } =
    fixture();
  for (const userMessage of [
    '수술을 받았어요.',
    'AI thinks this is a diagnosis.',
    source.slice(5),
  ])
    expect(action.parseInput({ userMessage })).toBeUndefined();
  confirmHistorySave.mockResolvedValue(false);
  expect(await action.authorize({ userMessage: source }, signal)).toBe(false);
  await expect(
    action.execute(request({ userMessage: source })),
  ).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  expect(
    await action.authorize({ userMessage: source }, controller.signal),
  ).toBe(false);
  expect(saveConversationHistory).not.toHaveBeenCalled();
});

test('current clear request wins over identical prior messages', async () => {
  const question = '작년에 수술했어요. 기억해 줘';
  const { action, confirmHistorySave, saveConversationHistory } = fixture(
    question,
    [question, question],
  );
  const input = { userMessage: question };
  expect(action.parseInput(input)).toEqual(input);
  expect(await action.authorize(input, signal)).toBe(true);
  await action.execute(request(input));
  expect(confirmHistorySave).not.toHaveBeenCalled();
  expect(saveConversationHistory).toHaveBeenCalledWith(
    expect.objectContaining({
      approvedSource: { requestId: 'request', text: '작년에 수술했어요.' },
    }),
    signal,
  );
});

test('ambiguous repeated prior wording and referential commands cannot be stored as facts', async () => {
  const { action } = fixture(undefined, [
    '예전에 수술했어요.',
    '예전에 수술했어요.',
  ]);
  expect(
    action.parseInput({ userMessage: '예전에 수술했어요.' }),
  ).toBeUndefined();
  for (const question of [
    '그 내용을 건강 기록에 저장해줘',
    '이 내용을 기억해줘',
    '그것을 기억해 줘',
  ]) {
    const { action, saveConversationHistory } = fixture(question);
    expect(action.parseInput({ userMessage: question })).toBeUndefined();
    expect(await action.authorize({ userMessage: question }, signal)).toBe(
      false,
    );
    expect(saveConversationHistory).not.toHaveBeenCalled();
  }
});
