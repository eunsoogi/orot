import { validateReplyPreferenceSpan } from '../authoredReplyPreferenceSpan';
import { conversationTaskV25 as ragConversationTask } from '../task';
import { restoreConversationTask } from '../conversationTaskVersions';

const authored = 'For future replies, I prefer concise answers.';
const current = 'A synthetic greeting. ' + authored + ' Unrelated context.';
const input = {
  request: current,
  evidence: { items: [], coverage: [], conflicts: [] },
};
const answer = { answerKind: 'conversation', answer: 'Synthetic answer.' };

test('only the new ordinary contract asks the model to choose an exact authored span', () => {
  const historic = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '24',
  });
  expect(historic?.createResultSchema?.(input)?.properties).not.toHaveProperty(
    'replyPreferenceSpan',
  );
  expect(
    ragConversationTask.createResultSchema?.(input)?.properties,
  ).toHaveProperty('replyPreferenceSpan');
  expect(
    ragConversationTask.createResultSchema?.({
      ...input,
      context: { intent: 'possibilities' },
    })?.properties,
  ).not.toHaveProperty('replyPreferenceSpan');
  expect(
    ragConversationTask.createResultSchema?.({
      ...input,
      context: { photoAttachment: true },
    })?.properties,
  ).not.toHaveProperty('replyPreferenceSpan');
  expect(ragConversationTask.validateResult(answer, input)).toMatchObject({
    status: 'valid',
    value: answer,
  });
  expect(
    ragConversationTask.validateResult(
      { ...answer, replyPreferenceSpan: authored },
      input,
    ),
  ).toMatchObject({
    status: 'valid',
    value: { ...answer, replyPreferenceSpan: authored },
  });
});

test.each([
  [current, 'For future replies, I prefer detailed answers.'],
  [current, authored.slice(1)],
  [current, current],
  [authored + ' ' + authored, authored],
  ['Don’t preserve this. ' + authored, authored],
  ['A friend said. ' + authored, authored],
  ['“' + authored + '” A greeting.', authored],
  ['This is a password. ' + authored, authored],
  ['Synthetic greeting. ' + authored, 'Synthetic greeting.'],
])(
  'does not persist ambiguous, non-authored or outside-grant spans: %s',
  (message, proposed) => {
    expect(validateReplyPreferenceSpan(message, proposed)).toBeUndefined();
  },
);
