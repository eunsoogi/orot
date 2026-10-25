import { extractPartialJsonStringAtPath } from '../src';

test('extracts only the requested nested string from an incomplete JSON response', () => {
  const response =
    '{"type":"result","note":"\\"summary\\":\\"private\\"","value":{"summary":"A safe answer';
  expect(extractPartialJsonStringAtPath(response, ['value', 'summary'])).toBe('A safe answer');
  expect(extractPartialJsonStringAtPath(response, ['summary'])).toBeUndefined();
});

test('decodes complete escapes and waits for a split Unicode surrogate pair', () => {
  const incomplete = '{"value":{"answer":"앞 \\"인용\\" \\uD83D';
  const complete = incomplete + '\\uDE00"}}';
  expect(extractPartialJsonStringAtPath(incomplete, ['value', 'answer'])).toBe('앞 "인용" ');
  expect(extractPartialJsonStringAtPath(complete, ['value', 'answer'])).toBe('앞 "인용" 😀');
});

test('selects a string only at the requested array index and object path', () => {
  const response = '{"value":{"questions":[{"questionText":"first?"},{"questionText":"second?';
  expect(extractPartialJsonStringAtPath(response, ['value', 'questions', 1, 'questionText'])).toBe(
    'second?',
  );
  expect(extractPartialJsonStringAtPath(response, ['value', 'questions', 0, 'questionText'])).toBe(
    'first?',
  );
});
