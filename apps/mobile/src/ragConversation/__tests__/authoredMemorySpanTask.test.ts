import { restoreConversationTask } from '../conversationTaskVersions';
import { ragConversationTask, conversationTaskV25 } from '../task';

const routine = 'I practice the guitar every Monday.';
const request = `This is some current context. ${routine} I also had lunch.`;
const input = { request, evidence: { items: [], coverage: [], conflicts: [] } };
const answer = { answer: 'Synthetic answer', answerKind: 'conversation' };

test('current model can select one authored routine; historic v25 schema remains exact', () => {
  expect(
    restoreConversationTask({
      taskType: ragConversationTask.taskType,
      taskVersion: '25',
    }),
  ).toBe(conversationTaskV25);
  const legacy = conversationTaskV25.createResultSchema?.(input).properties;
  expect(legacy).toHaveProperty('replyPreferenceSpan');
  expect(legacy).not.toHaveProperty('authoredMemorySpan');
  const current = ragConversationTask.createResultSchema?.(input).properties;
  expect(current).toHaveProperty('authoredMemorySpan');
  expect(current).not.toHaveProperty('replyPreferenceSpan');
  expect(
    ragConversationTask.validateResult(
      { ...answer, authoredMemorySpan: routine },
      input,
    ),
  ).toMatchObject({
    status: 'valid',
    value: { ...answer, authoredRoutineSpan: routine },
  });
});

test.each([
  {
    payload: { authoredMemorySpan: 'I practice the piano every Monday.' },
    request: candidateRequest,
  },
  {
    payload: { authoredMemorySpan: routine },
    request: `My sibling said: '${routine}' I had lunch.`,
  },
  {
    payload: { authoredMemorySpan: routine },
    request: `${routine} ${routine}`,
  },
  { payload: { authoredRoutineSpan: routine }, request },
  { payload: {}, request },
])(
  'unproven or omitted proposals cannot admit an automatic routine',
  ({ payload, request: candidateRequest }) => {
    expect(
      ragConversationTask.validateResult(
        { ...answer, ...payload },
        { ...input, request: candidateRequest },
      ),
    ).toMatchObject({ status: 'valid', value: answer });
    const result = ragConversationTask.validateResult(
      { ...answer, ...payload },
      { ...input, request: candidateRequest },
    );
    if (result.status === 'valid')
      expect(result.value.authoredRoutineSpan).toBeUndefined();
  },
);
