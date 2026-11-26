import {
  createStockLiveToolCatalog,
  type StockLiveToolDescriptor,
} from '../stockLiveToolCatalog';

function descriptor(name: string, input: string, output: string) {
  return {
    declaration: {
      name,
      description: `Synthetic ${name}`,
      parameters: { type: 'object', required: ['window', 'scope'] },
    },
    arguments: {
      maxCodeUnits: 48,
      acceptsExact: (raw: string) => raw === input,
    },
    result: {
      maxCodeUnits: 48,
      acceptsExact: (raw: string) => raw === output,
    },
  } satisfies StockLiveToolDescriptor;
}

test('compares the exact ordered static manifest without authorizing a call', () => {
  const first = descriptor('first-tool', 'one in', 'one out');
  const second = descriptor('second-tool', 'two in', 'two out');
  const catalog = createStockLiveToolCatalog('synthetic-v1', [first, second]);
  const tools = [first.declaration, second.declaration];
  expect(catalog.matchesManifest({ tools, revision: 'synthetic-v1' })).toBe(
    true,
  );
  expect(
    catalog.matchesManifest({
      tools: [...tools].reverse(),
      revision: 'synthetic-v1',
    }),
  ).toBe(false);
  expect(catalog.matchesManifest({ tools, revision: 'synthetic-v2' })).toBe(
    false,
  );
  expect(
    catalog.matchesManifest({ tools, revision: 'synthetic-v1', trusted: true }),
  ).toBe(false);
  const drifted = [
    {
      ...first.declaration,
      parameters: { type: 'object', required: ['scope', 'window'] },
    },
    second.declaration,
  ];
  expect(
    catalog.matchesManifest({ tools: drifted, revision: 'synthetic-v1' }),
  ).toBe(false);
  first.declaration.parameters.required.reverse();
  expect(catalog.manifest.tools[0]?.parameters.required).toEqual([
    'window',
    'scope',
  ]);
  expect(Object.isFrozen(catalog.manifest.tools[0]?.parameters.required)).toBe(
    true,
  );
});

test('selects paired byte-preserving argument and result validation by exact name', () => {
  const first = descriptor('first-tool', '{"input":1}', '{"result":1}');
  const second = descriptor('second-tool', '{"input":2}', '{"result":2}');
  const catalog = createStockLiveToolCatalog('synthetic-v1', [first, second]);
  expect(catalog.acceptsArguments('first-tool', '{"input":1}')).toBe(true);
  expect(catalog.acceptsArguments('second-tool', '{"input":2}')).toBe(true);
  expect(catalog.acceptsArguments('first-tool', '{"input":2}')).toBe(false);
  expect(catalog.acceptsArguments('first-tool', '{"input": 1}')).toBe(false);
  expect(catalog.acceptsResult('first-tool', '{"result":1}')).toBe(true);
  expect(catalog.acceptsResult('second-tool', '{"result":2}')).toBe(true);
  expect(catalog.acceptsResult('second-tool', '{"result":1}')).toBe(false);
  expect(catalog.acceptsResult('unknown-tool', '{"result":1}')).toBe(false);
  expect(catalog.acceptsResult('first-tool', 'a'.repeat(49))).toBe(false);
});

test('rejects duplicate definitions and fails closed on throwing validators', () => {
  const first = descriptor('first-tool', 'input', 'output');
  expect(() =>
    createStockLiveToolCatalog('synthetic-v1', [first, first]),
  ).toThrow('Invalid static tool declaration.');
  const catalog = createStockLiveToolCatalog('synthetic-v1', [
    {
      ...first,
      result: {
        maxCodeUnits: 24,
        acceptsExact() {
          throw new Error('Synthetic invalid result.');
        },
      },
    },
  ]);
  expect(catalog.acceptsResult('first-tool', 'output')).toBe(false);
  expect(
    catalog.matchesManifest({ revision: 'synthetic-v1', tools: [first] }),
  ).toBe(false);
});

test('does not arbitrarily cap the application-owned catalog', () => {
  const entries = Array.from({ length: 12 }, (_, index) =>
    descriptor(`stock-${index}`, `in-${index}`, `out-${index}`),
  );
  const catalog = createStockLiveToolCatalog('synthetic-v1', entries);
  expect(catalog.manifest.tools).toHaveLength(12);
  expect(catalog.acceptsResult('stock-11', 'out-11')).toBe(true);
  expect(catalog.acceptsResult('stock-11', 'out-0')).toBe(false);
});
