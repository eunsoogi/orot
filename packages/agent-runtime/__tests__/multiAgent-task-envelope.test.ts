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
] as const)(
  'classifies a rejected envelope without returning its content: %s',
  async (value, code) => {
    const decoded = await decodeTaskResponse(response(value));
    expect(decoded.output).toBeUndefined();
    expect(decoded.reason).toBe(`The task responder returned an invalid envelope: ${code}.`);
    expect(decoded.reason).not.toMatch(/private/);
  },
);

test('distinguishes JSON decoding from the schema envelope without exposing raw text', async () => {
  await expect(decodeTaskResponse({ text: 'synthetic private text' })).resolves.toEqual({
    reason: 'The task responder returned an invalid envelope: json.',
  });
});

test.each([
  ['malformed JSON', '{"type":"result", value}', 'json'],
  ['incomplete JSON', '{"type":"result","value":{"summary":"partial"},"citations":[]', 'json'],
  [
    'a schema-invalid envelope',
    '{"type":"result","value":{"summary":"ok"},"citations":[],"private_field":"secret"}',
    'fields',
  ],
] as const)('returns a controlled failure for %s', async (_name, text, code) => {
  const decoded = await decodeTaskResponse({ text });

  expect(decoded).toEqual({
    reason: `The task responder returned an invalid envelope: ${code}.`,
  });
  expect(decoded.reason).not.toContain('secret');
  expect(decoded.reason).not.toContain(text);
});

test('uses the standard parser to accept a fenced JSON object', async () => {
  const value = { type: 'result', value: { answer: 'Synthetic answer' }, citations: [] };
  const text = `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;

  expect(await decodeTaskResponse({ text })).toEqual({ output: value });
});

test('keeps structured output precedence and exact accepted contents', async () => {
  const value = { type: 'result', value: { summary: 'Synthetic summary' }, citations: [] };
  await expect(decodeTaskResponse({ text: 'ignored', structuredOutput: value })).resolves.toEqual({
    output: value,
  });
  await expect(decodeTaskResponse({ text: JSON.stringify(value) })).resolves.toEqual({
    output: value,
  });
});
