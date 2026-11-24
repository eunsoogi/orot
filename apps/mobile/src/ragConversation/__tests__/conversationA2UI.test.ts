import {
  applyConversationA2UIFrame,
  conversationA2UICatalog,
  makeConversationA2UISurfaceId,
} from '../conversationA2UI';

const surfaceId = makeConversationA2UISurfaceId(
  'test-conversation',
  'assistant-message',
);
const frame = (name: string, body: object = {}) =>
  JSON.stringify({ version: '1.0', [name]: { surfaceId, ...body } });
const create = (components: object[], extra: object = {}) =>
  frame('createSurface', {
    catalogId: conversationA2UICatalog,
    components,
    ...extra,
  });
const text = (id: string, value: unknown) => ({
  id,
  component: 'Text',
  text: value,
});
const card = (child: string) => ({ id: 'root', component: 'Card', child });
const apply = (raw: string) => applyConversationA2UIFrame(null, raw, surfaceId);

test('updates a single owned surface only when the complete tree resolves', () => {
  const first = apply(
    create(
      [
        card('list'),
        { id: 'list', component: 'List', children: ['pair'] },
        { id: 'pair', component: 'Row', children: ['label', 'value'] },
        text('label', 'Synthetic label'),
        text('value', { '@path': '/demo/value' }),
      ],
      { dataModel: { hidden: 'unused data' } },
    ),
  );
  expect(first?.status).toBe('pending');
  const ready = applyConversationA2UIFrame(
    first,
    frame('updateDataModel', {
      path: '/demo/value',
      value: 'Synthetic value',
    }),
    surfaceId,
  );
  expect(ready?.root).toMatchObject({
    component: 'Card',
    children: [
      {
        component: 'List',
        children: [
          {
            component: 'Row',
            children: [
              { id: 'label', text: 'Synthetic label' },
              { id: 'value', text: 'Synthetic value' },
            ],
          },
        ],
      },
    ],
  });
  const updated = applyConversationA2UIFrame(
    ready,
    frame('updateComponents', {
      components: [text('label', 'Updated label')],
    }),
    surfaceId,
  );
  expect(updated?.root).not.toEqual(ready?.root);
  expect(JSON.stringify(updated?.root)).not.toMatch(/hidden|@path/);
});

test('ignores foreign and stopped frames without changing another bubble', () => {
  const current = apply(create([text('root', 'keep')]));
  expect(
    applyConversationA2UIFrame(
      current,
      frame('deleteSurface', { surfaceId: 'orot:test-conversation:old' }),
      surfaceId,
    ),
  ).toBe(current);
  const deleted = applyConversationA2UIFrame(
    current,
    frame('deleteSurface'),
    surfaceId,
  );
  expect(deleted?.status).toBe('deleted');
  expect(
    applyConversationA2UIFrame(
      deleted,
      create([text('root', 'resurrect')]),
      surfaceId,
    ),
  ).toBe(deleted);
});

test.each([
  [
    'external catalog',
    create([text('root', 'unused')], {
      catalogId: 'https://example.invalid/catalog.json',
    }),
  ],
  ['data sync', create([text('root', 'unused')], { sendDataModel: true })],
  [
    'actions',
    create([{ ...text('root', 'unused'), action: { event: { name: 'run' } } }]),
  ],
  [
    'RPC',
    frame('callRendererFunction', {
      functionCallId: 'c',
      callFunction: { '@call': 'openUrl' },
    }),
  ],
  ['function binding', create([text('root', { '@call': 'formatString' })])],
  [
    'remote image',
    create([
      { id: 'root', component: 'Image', url: 'https://example.invalid/a' },
    ]),
  ],
  ['wrong version', create([text('root', 'unused')]).replace('"1.0"', '"0.9"')],
  ['relative path', create([text('root', { '@path': 'a/b' })])],
  [
    'prototype path',
    create([text('root', { '@path': '/constructor/prototype' })]),
  ],
  [
    'object reference',
    create([text('root', { '@path': '/a' })], {
      dataModel: { a: { b: 'not a string' } },
    }),
  ],
  [
    'explicit per-component catalog',
    create([
      { ...text('root', 'unused'), '@catalogId': conversationA2UICatalog },
    ]),
  ],
  [
    'control characters in IDs',
    create([text('root', 'ok'), text('item\\n', 'bad')]),
  ],
  [
    'overdeep tree',
    create([
      ...Array.from({ length: 10 }, (_, index) => ({
        id: index === 0 ? 'root' : 'layer_' + index,
        component: 'Card',
        child: 'layer_' + (index + 1),
      })),
      text('layer_10', 'deep'),
    ]),
  ],
  ['duplicate IDs', create([text('root', 'one'), text('root', 'two')])],
  [
    'shared child',
    create([
      { id: 'root', component: 'Column', children: ['a', 'b'] },
      { id: 'a', component: 'Card', child: 'leaf' },
      { id: 'b', component: 'Card', child: 'leaf' },
      text('leaf', 'child'),
    ]),
  ],
  [
    'disconnected cycle',
    create([
      text('root', 'visible'),
      { id: 'loop', component: 'Card', child: 'loop' },
    ]),
  ],
  ['oversized frame', create([text('root', 'x'.repeat(20_000))])],
  [
    'oversized tree',
    create(
      Array.from({ length: 65 }, (_, index) => text('item_' + index, 'x')),
    ),
  ],
])('rejects %s without a render model', (_feature, raw) => {
  const result = apply(raw);
  expect(result?.status).toBe('invalid');
  expect(result?.root).toBeNull();
});

test('does not expose a partial, orphaned, or missing-child surface', () => {
  for (const raw of [
    create([text('root', 'visible'), text('orphan', 'invisible')]),
    create([card('missing')]),
    create([text('not-root', 'cannot show')]),
  ]) {
    expect(apply(raw)?.root).toBeNull();
  }
});

test('bounds cumulative frame work even for repeated updates of one existing node', () => {
  let state = apply(create([text('root', 'first')]));
  for (let index = 0; index < 48; index += 1) {
    state = applyConversationA2UIFrame(
      state,
      frame('updateComponents', { components: [text('root', 'later')] }),
      surfaceId,
    );
  }
  expect(state?.status).toBe('invalid');
});
