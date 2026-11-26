import { nativeToolParameterSchema } from '@orot/agent-runtime';
import { matchesOwnedLiveConversationDeclarations } from '../ownedLiveConversationDeclarations';

const schema = { type: 'object', additionalProperties: false };
const a = { id: 'stock-a', description: 'Stock A', inputSchema: schema };
const b = { ...a, id: 'stock-b', description: 'Stock B' };
const declaration = (tool: typeof a) => ({
  name: tool.id,
  description: tool.description,
  parameters: nativeToolParameterSchema(tool.inputSchema),
});

test('uses the complete exact neutral declarations in Chat order', () => {
  const native = [declaration(a), declaration(b)];
  expect(matchesOwnedLiveConversationDeclarations([a, b], native)).toBe(true);
  expect(matchesOwnedLiveConversationDeclarations([b, a], native)).toBe(false);
  expect(matchesOwnedLiveConversationDeclarations([a], native)).toBe(false);
  expect(
    matchesOwnedLiveConversationDeclarations(
      [a, { ...b, description: 'Changed' }],
      native,
    ),
  ).toBe(false);
  expect(
    matchesOwnedLiveConversationDeclarations([a, a], [native[0]!, native[0]!]),
  ).toBe(false);
});
