import { decodeTaskResponse } from '../src/multiAgent/taskResponseDecoding';

const response = (value: unknown) => ({ text: '', structuredOutput: value });

test.each([
  [null, 'object'],
  [[], 'object'],
  [{ type: 'synthetic private type' }, 'type'],
  [{ type: 'result', value: {}, citations: null }, 'citations'],
  [{ type: 'result', citations: [] }, 'value'],
  [{ type: 'result', value: {}, citations: [], private_key: 'private content' }, 'fields'],
  [{ type: 'request_evidence', need: 'private content' }, 'need'],
] as const)('classifies a rejected envelope without returning its content: %s', (value, code) => {
  const decoded = decodeTaskResponse(response(value));
  expect(decoded.output).toBeUndefined();
  expect(decoded.reason).toBe(`The task responder returned an invalid envelope: ${code}.`);
  expect(decoded.reason).not.toMatch(/private/);
});

test('distinguishes JSON decoding from the schema envelope without exposing raw text', () => {
  expect(decodeTaskResponse({ text: 'synthetic private text' })).toEqual({
    reason: 'The task responder returned an invalid envelope: json.',
  });
});

test('keeps structured output precedence and exact accepted contents', () => {
  const value = { type: 'result', value: { summary: 'Synthetic summary' }, citations: [] };
  expect(decodeTaskResponse({ text: 'ignored', structuredOutput: value })).toEqual({
    output: value,
  });
  expect(decodeTaskResponse({ text: JSON.stringify(value) })).toEqual({ output: value });
});
