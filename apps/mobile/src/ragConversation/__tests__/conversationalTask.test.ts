import { ragConversationTask } from '../task';

const input = {
  request: '고마워요',
  evidence: { items: [], coverage: [], conflicts: [] },
};

test.each(['천만에요!', '어떤 점이 가장 궁금하세요?', '계속 이야기해 주세요.'])(
  'accepts a model-declared conversational reply without claiming record evidence: %s',
  answer => {
    expect(
      ragConversationTask.validateResult(
        { answerKind: 'conversation', answer },
        input,
      ),
    ).toEqual({
      status: 'valid',
      value: { answerKind: 'conversation', answer },
    });
  },
);

test('still requires evidence for a substantive answer, including legacy results', () => {
  expect(
    ragConversationTask.validateResult(
      { answerKind: 'grounded', answer: '기록에 관한 답변' },
      input,
    ).status,
  ).toBe('needs_clarification');
  expect(
    ragConversationTask.validateResult({ answer: '기록에 관한 답변' }, input)
      .status,
  ).toBe('needs_clarification');
});

test.each(['unsupported', null, 1])(
  'rejects unknown answer kinds rather than treating them as conversation: %s',
  answerKind => {
    expect(
      ragConversationTask.validateResult({ answerKind, answer: '답변' }, input)
        .status,
    ).toBe('invalid');
  },
);

test('projects only explicitly conversational text before evidence is available', () => {
  const project = ragConversationTask.projectStreamedText!;
  const conversation = JSON.stringify({
    type: 'result',
    value: {
      answerKind: 'conversation',
      answer: '천만에요!',
    },
    citations: [],
  });
  const grounded = conversation.replace('conversation', 'grounded');
  expect(project(conversation, input)).toBe('천만에요!');
  expect(project(grounded, input)).toBeUndefined();
});
