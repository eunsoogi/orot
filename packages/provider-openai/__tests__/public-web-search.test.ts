import { createChatGPTPlanProvider } from '../src';
import type { ChatGPTPlanPublicWebRequest } from '../src';
import { FakeBridge } from './providerTestSupport';

const webSearch = {
  callCount: 1,
  citations: [{ url: 'https://example.org/source', title: 'Synthetic source' }],
};
const text = 'Synthetic public explanation.';

function fixture(onStart?: (bridge: FakeBridge, id: string) => Promise<void>) {
  const bridge = new FakeBridge();
  const startPublicWebSearch = jest.fn(
    async (id: string, _account: string, _request: ChatGPTPlanPublicWebRequest) => {
      if (onStart) return onStart(bridge, id);
      bridge.emit({ requestId: id, type: 'text_delta', text });
      bridge.emit({ requestId: id, type: 'completed', text, webSearch });
    },
  );
  const extended = Object.assign(bridge, { startPublicWebSearch });
  const provider = createChatGPTPlanProvider({
    bridge: extended,
    issuedClientID: 'synthetic-account',
    model: { slug: 'gpt-6-luna', displayName: 'GPT-6-Luna' },
    requestIDFactory: () => 'public-request',
  });
  return { bridge, provider, startPublicWebSearch };
}

test('sends one isolated public query through the selected account and model', async () => {
  const run = fixture();
  await expect(run.provider.searchPublicWeb!({ query: 'Public health concept' })).resolves.toEqual({
    ok: true,
    value: { text, ...webSearch },
  });
  expect(run.startPublicWebSearch).toHaveBeenCalledTimes(1);
  expect(run.startPublicWebSearch).toHaveBeenCalledWith('public-request', 'synthetic-account', {
    model: 'gpt-6-luna',
    publicWebQuery: 'Public health concept',
  });
  expect(run.bridge.started).toHaveLength(0);
  expect(run.bridge.cancelled).toHaveLength(0);
});

test('does not advertise public search on a bridge without that transport', () => {
  const provider = createChatGPTPlanProvider({
    bridge: new FakeBridge(),
    issuedClientID: 'synthetic-account',
    model: { slug: 'model', displayName: 'Model' },
  });
  expect(provider.searchPublicWeb).toBeUndefined();
});

test.each(['', ' query', 'query\nidentifier', 'a'.repeat(241)])(
  'rejects an invalid query before dispatch',
  async (query) => {
    const run = fixture();
    await expect(run.provider.searchPublicWeb!({ query })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_request' },
    });
    expect(run.startPublicWebSearch).not.toHaveBeenCalled();
  },
);

test('does not dispatch an already cancelled request', async () => {
  const run = fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(
    run.provider.searchPublicWeb!({ query: 'Public concept' }, { signal: controller.signal }),
  ).resolves.toMatchObject({ ok: false });
  expect(run.startPublicWebSearch).not.toHaveBeenCalled();
});

test('cancels promptly and repeats the stop request after a late bridge registration', async () => {
  let started!: () => void, release!: () => void;
  const didStart = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pendingStart = new Promise<void>((resolve) => {
    release = resolve;
  });
  const run = fixture(async () => {
    started();
    await pendingStart;
  });
  const controller = new AbortController();
  const pending = run.provider.searchPublicWeb!(
    { query: 'Public concept' },
    { signal: controller.signal },
  );
  try {
    await didStart;
    controller.abort();
    await expect(pending).resolves.toMatchObject({ ok: false });
    expect(run.bridge.cancelled).toEqual(['public-request']);
    release();
    await run.startPublicWebSearch.mock.results[0]!.value;
    expect(run.bridge.cancelled).toEqual(['public-request', 'public-request']);
  } finally {
    controller.abort();
    release();
    await pending;
  }
});

test.each([
  undefined,
  null as never,
  { ...webSearch, callCount: 3 },
  { ...webSearch, callCount: 1.5 },
  { ...webSearch, citations: [] },
  { ...webSearch, citations: [{ url: 'file:///private', title: 'Invalid' }] },
  { ...webSearch, citations: [{ url: 'https://user:secret@example.org', title: 'Invalid' }] },
])(
  'rejects invalid bridge citation metadata rather than fabricating evidence',
  async (metadata) => {
    const run = fixture(async (bridge, id) => {
      bridge.emit({ requestId: id, type: 'text_delta', text });
      bridge.emit({ requestId: id, type: 'completed', text, webSearch: metadata });
    });
    await expect(run.provider.searchPublicWeb!({ query: 'Public concept' })).resolves.toMatchObject(
      { ok: false },
    );
    expect(run.bridge.cancelled).toContain('public-request');
  },
);

test('bounds multibyte text independently of TextEncoder availability', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'TextEncoder');
  Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: undefined });
  try {
    const run = fixture(async (bridge, id) => {
      bridge.emit({ requestId: id, type: 'text_delta', text: '한'.repeat(10_923) });
    });
    await expect(run.provider.searchPublicWeb!({ query: 'Public concept' })).resolves.toMatchObject(
      { ok: false },
    );
    expect(run.bridge.cancelled).toContain('public-request');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'TextEncoder', descriptor);
    else Reflect.deleteProperty(globalThis, 'TextEncoder');
  }
});

test.each(['mismatched-text', 'oversized-text', 'function-call'])(
  'rejects %s on the isolated public channel',
  async (kind) => {
    const run = fixture(async (bridge, id) => {
      if (kind === 'function-call') {
        bridge.emit({
          requestId: id,
          type: 'tool_call',
          toolCall: { id: 'private', name: 'read_records', arguments: '{}' },
        });
      } else {
        bridge.emit({
          requestId: id,
          type: 'text_delta',
          text: kind === 'oversized-text' ? 'a'.repeat(32_769) : 'Different',
        });
        bridge.emit({ requestId: id, type: 'completed', text, webSearch });
      }
    });
    await expect(run.provider.searchPublicWeb!({ query: 'Public concept' })).resolves.toMatchObject(
      { ok: false },
    );
  },
);

test('preserves model/account policy rejection without falling back to an unrelated provider', async () => {
  const run = fixture(async (bridge, id) => {
    bridge.emit({ requestId: id, type: 'failed', error: { kind: 'unsupported_capability' } });
  });
  await expect(run.provider.searchPublicWeb!({ query: 'Public concept' })).resolves.toMatchObject({
    ok: false,
    error: { code: 'unsupported_capability' },
  });
  expect(run.startPublicWebSearch).toHaveBeenCalledTimes(1);
  expect(run.bridge.started).toHaveLength(0);
});
