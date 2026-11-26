import { nativeToolParameterSchema } from '@orot/agent-runtime';
import { healthContextToolDefinition } from '../../conversationTools/healthContextToolDefinition';
import { liveStockHealthCatalog } from '../liveStockHealthDescriptor';

const tool = healthContextToolDefinition('rag');
const item = {
  evidenceId: 'fixture-alias',
  evidenceRevision: 'fixture-revision',
  content: 'Synthetic app-projected measurement.',
};
const bytes = (items: unknown[]) => JSON.stringify({ tool: tool.id, items });

test('uses the exact stock declaration, not a new voice-only schema', () => {
  expect(liveStockHealthCatalog.manifest).toEqual({
    revision: 'canonical-health-context-v3',
    tools: [
      {
        name: tool.id,
        description: tool.description,
        parameters: nativeToolParameterSchema(tool.inputSchema),
      },
    ],
  });
  expect(liveStockHealthCatalog.acceptsArguments(tool.id, '{}')).toBe(true);
  expect(liveStockHealthCatalog.acceptsArguments(tool.id, '{"days":0}')).toBe(
    false,
  );
  expect(
    liveStockHealthCatalog.acceptsArguments(tool.id, '{"query":"unknown"}'),
  ).toBe(false);
  expect(
    liveStockHealthCatalog.acceptsArguments('public-web-search', '{}'),
  ).toBe(false);
});

test('checks projected result shape without authorizing data, another name or an expanded payload', () => {
  expect(liveStockHealthCatalog.acceptsResult(tool.id, bytes([item]))).toBe(
    true,
  );
  expect(
    liveStockHealthCatalog.acceptsResult('public-web-search', bytes([item])),
  ).toBe(false);
  expect(
    liveStockHealthCatalog.acceptsResult(tool.id, bytes([item, item])),
  ).toBe(false);
  expect(
    liveStockHealthCatalog.acceptsResult(
      tool.id,
      bytes([{ ...item, hidden: 'x' }]),
    ),
  ).toBe(false);
  const wide = bytes([{ ...item, content: '한'.repeat(3000) }]);
  expect(liveStockHealthCatalog.acceptsResult(tool.id, wide)).toBe(false);
});
