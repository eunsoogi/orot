import { createChatGPTPlanProvider } from '../src';
import { baseRequest, FakeBridge } from './providerTestSupport';

function provider(bridge: FakeBridge) {
  return createChatGPTPlanProvider({
    bridge,
    issuedClientID: 'synthetic',
    model: { slug: 'synthetic', displayName: 'Synthetic' },
    requestIDFactory: () => 'request',
  });
}

test('request-bound processing notification arrives before text and only once', async () => {
  const observed: string[] = [];
  const bridge = new FakeBridge(async (requestId, current) => {
    current.emit({ requestId: 'foreign', type: 'response_started', responseId: 'other' });
    current.emit({ requestId, type: 'response_started', responseId: 'response' });
    current.emit({ requestId, type: 'response_started', responseId: 'response' });
    current.emit({ requestId, type: 'text_delta', text: 'answer' });
    current.emit({ requestId, type: 'completed', text: 'answer' });
  });
  for await (const item of provider(bridge).stream!(baseRequest, {
    onResponseStarted: () => observed.push('processing'),
  })) {
    if (item.ok) observed.push(item.value.type);
  }
  expect(observed).toEqual(['processing', 'text_delta', 'completed']);
});

test('dispatch and local readiness do not produce processing receipts', async () => {
  const started = jest.fn();
  const bridge = new FakeBridge(async (requestId, current) => {
    current.emit({ requestId, type: 'steering_ready' });
    current.emit({ requestId, type: 'failed', error: { kind: 'transport' } });
  });
  await provider(bridge).generate(baseRequest, { onResponseStarted: started });
  expect(started).not.toHaveBeenCalled();
});

test('malformed or cancelled native receipt cannot mark a request processing', async () => {
  const started = jest.fn();
  const malformed = new FakeBridge(async (requestId, current) => {
    current.emit({ requestId, type: 'response_started', responseId: ' ' });
  });
  expect((await provider(malformed).generate(baseRequest, { onResponseStarted: started })).ok).toBe(
    false,
  );
  const controller = new AbortController();
  const bridge = new FakeBridge(async (requestId, current) => {
    controller.abort();
    current.emit({ requestId, type: 'response_started', responseId: 'late' });
  });
  await provider(bridge).generate(baseRequest, {
    signal: controller.signal,
    onResponseStarted: started,
  });
  expect(started).not.toHaveBeenCalled();
});
