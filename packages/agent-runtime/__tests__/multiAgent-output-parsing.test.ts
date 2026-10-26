import { parseJsonOutput } from '../src/multiAgent/protocol';

test('parses fenced generic JSON through the standard output parser', async () => {
  await expect(
    parseJsonOutput({ text: '```json\n{"toolId":"search","query":{"term":"source"}}\n```' }),
  ).resolves.toEqual({ toolId: 'search', query: { term: 'source' } });
});

test.each([
  ['malformed JSON', '{"toolId":}'],
  ['incomplete JSON', '{"toolId":"search"'],
] as const)('rejects %s instead of returning a partial object', async (_name, text) => {
  await expect(parseJsonOutput({ text })).rejects.toThrow();
});

test('preserves structured provider output precedence over text parsing', async () => {
  const structuredOutput = { toolId: 'search', query: { term: 'source' } };

  await expect(parseJsonOutput({ text: 'not JSON', structuredOutput })).resolves.toBe(
    structuredOutput,
  );
});
