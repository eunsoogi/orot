import { boundRagConversationHistory } from '../evidencePayload';
import { jsonByteLength, utf8ByteLength } from '../evidenceUtils';

test('counts Korean and supplementary Unicode text as UTF-8 bytes', () => {
  expect(utf8ByteLength('A한😀')).toBe(8);
  expect(jsonByteLength({ content: '한' })).toBe(17);
});

test('keeps the newest chat history within its UTF-8 request allowance', () => {
  const history = boundRagConversationHistory([
    { role: 'user', content: '오래된 질문'.repeat(1_000) },
    { role: 'assistant', content: '최근 답변 😀'.repeat(1_000) },
    { role: 'user', content: '현재 질문' },
  ]);

  expect(history.at(-1)).toEqual({ role: 'user', content: '현재 질문' });
  expect(
    history.reduce(
      (total, message) => total + utf8ByteLength(message.content),
      0,
    ),
  ).toBeLessThanOrEqual(4 * 1024);
});
