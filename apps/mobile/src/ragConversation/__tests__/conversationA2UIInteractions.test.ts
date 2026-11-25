import { createConversationA2UIInteractions } from '../conversationA2UIInteractions';

function fixture() {
  const owner = Object.freeze({});
  const surfaceId = 'orot:response:synthetic';
  let active = true;
  let clock = new Date('2026-01-01T00:00:00Z');
  const options = {
    owner,
    surfaceId,
    isCurrent: () => active,
    now: () => clock,
    renderedComponentIds: new Set(['input', 'toggle', 'next', 'review']),
    allowedActionNames: new Set(['local_review']),
    fields: [
      { componentId: 'input', path: '/form/text', kind: 'text', initial: '' },
      {
        componentId: 'toggle',
        path: '/form/selected',
        kind: 'boolean',
        initial: false,
      },
    ],
    events: [
      {
        componentId: 'review',
        name: 'local_review',
        context: [
          { key: 'draft', path: '/form/text' },
          { key: 'selected', path: '/form/selected' },
        ],
      },
      { componentId: 'next', name: 'local_review', context: [] },
    ],
  } as const;
  return {
    options,
    edit: { owner, surfaceId, componentId: 'input' },
    review: { owner, surfaceId, componentId: 'review' },
    activate(value: boolean) {
      active = value;
    },
    later() {
      clock = new Date('2026-01-02T00:00:00Z');
    },
  };
}

test('binds exact rendered control and builds a one-use v1.0 action with only current local fields', () => {
  const f = fixture();
  const store = createConversationA2UIInteractions(f.options)!;
  expect(store.write(f.edit, 'synthetic title')).toBe(true);
  const receipt = store.prepareAction(f.review, 'local_review')!;
  expect(receipt).toBeDefined();
  f.later();
  expect(
    store.consumeAction({ ...f.review, componentId: 'next' }, receipt),
  ).toBeUndefined();
  expect(
    store.consumeAction({ ...f.review, owner: {} }, receipt),
  ).toBeUndefined();
  const message = store.consumeAction(f.review, receipt);
  expect(message).toEqual({
    version: '1.0',
    action: {
      name: 'local_review',
      surfaceId: f.options.surfaceId,
      sourceComponentId: 'review',
      timestamp: '2026-01-01T00:00:00.000Z',
      context: { draft: 'synthetic title', selected: false },
    },
  });
  expect(store.consumeAction(f.review, receipt)).toBeUndefined();
  expect(store.consumeAction(f.review, {})).toBeUndefined();
  expect(store.consumeAction(f.review, { ...receipt })).toBeUndefined();
  expect(store.read(f.edit)).toBe('synthetic title');
  expect(store.revert(f.edit)).toBe(true);
  expect(store.read(f.edit)).toBe('');
});

test('rejects edited receipts, foreign targets, unknown actions and arbitrary payloads', () => {
  const f = fixture();
  const store = createConversationA2UIInteractions(f.options)!;
  for (const invalid of [null, undefined, 1, true, {}, [], 'a'.repeat(257)])
    expect(store.write(f.edit, invalid)).toBe(false);
  expect(
    store.prepareAction(f.review, { name: 'local_review' }),
  ).toBeUndefined();
  expect(store.prepareAction(f.review, 'transmit')).toBeUndefined();
  const foreign = { ...f.review, surfaceId: 'orot:response:foreign' };
  expect(store.prepareAction(foreign, 'local_review')).toBeUndefined();
  const receipt = store.prepareAction(f.review, 'local_review')!;
  expect(store.write(f.edit, 'replacement')).toBe(true);
  expect(store.consumeAction(f.review, receipt)).toBeUndefined();
  const owned = store.prepareAction(f.review, 'local_review')!;
  f.activate(false);
  expect(store.consumeAction(f.review, owned)).toBeUndefined();
  f.activate(true);
  expect(store.prepareAction(f.review, 'local_review')).toBeUndefined();
  expect(store.read(f.edit)).toBeUndefined();
});

test('rejects non-rendered controls, unsafe paths and undeclared context', () => {
  const f = fixture();
  expect(
    createConversationA2UIInteractions({
      ...f.options,
      allowedActionNames: new Set(),
    }),
  ).toBeUndefined();
  expect(
    createConversationA2UIInteractions({
      ...f.options,
      renderedComponentIds: new Set(['toggle', 'next', 'review']),
    }),
  ).toBeUndefined();
  for (const path of [
    '/constructor/text',
    '/form/~1encoded',
    '/form/0',
    'relative',
    '/form/selected',
    '/form',
  ]) {
    expect(
      createConversationA2UIInteractions({
        ...f.options,
        fields: [{ ...f.options.fields[0], path }, f.options.fields[1]],
      }),
    ).toBeUndefined();
  }
  expect(
    createConversationA2UIInteractions({
      ...f.options,
      events: [
        {
          ...f.options.events[0],
          context: [{ key: 'hidden', path: '/private' }],
        },
      ],
    }),
  ).toBeUndefined();
});

test('bounds outstanding receipts and retires discarded surfaces', () => {
  const f = fixture();
  const store = createConversationA2UIInteractions(f.options)!;
  const pending = Array.from({ length: 8 }, () =>
    store.prepareAction(f.review, 'local_review'),
  );
  expect(pending.every(Boolean)).toBe(true);
  expect(store.prepareAction(f.review, 'local_review')).toBeUndefined();
  store.retire();
  expect(store.consumeAction(f.review, pending[0]!)).toBeUndefined();
  expect(store.write(f.edit, 'denied')).toBe(false);
});
