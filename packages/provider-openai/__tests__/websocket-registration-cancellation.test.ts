import { createChatGPTPlanProvider } from '../src';
import type { ChatGPTPlanRequest } from '../src';
import { baseRequest, FakeBridge } from './providerTestSupport';

function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, promise };
}

class DelayedSocketBridge extends FakeBridge {
  readonly requested: {
    id: string;
    account: string;
    request: ChatGPTPlanRequest;
  }[] = [];
  readonly active = new Set<string>();
  readonly waiting = latch();
  readonly registration = latch();
  readonly firstAck = latch();

  async startSteerableResponse(id: string, account: string, request: ChatGPTPlanRequest) {
    this.requested.push({ id, account, request });
    if (id === 'first') {
      this.waiting.release();
      await this.registration.promise;
    }
    this.active.add(id);
    this.emit({ requestId: id, type: 'steering_ready' });
    if (id === 'first') this.firstAck.release();
  }

  async steerResponse() {
    throw new Error('This fixture does not send a steer.');
  }

  cancelResponse(id: string) {
    super.cancelResponse(id);
    this.active.delete(id);
  }

  finish(id: string, text: string, cachedInputTokens: number) {
    this.active.delete(id);
    this.emit({ requestId: id, type: 'text_delta', text });
    this.emit({
      requestId: id,
      type: 'completed',
      text,
      usage: {
        inputTokens: 10,
        outputTokens: 1,
        totalTokens: 11,
        cachedInputTokens,
      },
    });
  }
}

const steering = {
  onReady: () => {},
  onEvent: async () => {},
};

function setup() {
  const bridge = new DelayedSocketBridge();
  const ids = ['first', 'second'].values();
  const provider = createChatGPTPlanProvider({
    bridge,
    issuedClientID: 'synthetic-account',
    model: {
      slug: 'gpt-6',
      displayName: 'Synthetic',
      supportsMidTurnSteering: true,
    },
    requestIDFactory: () => ids.next().value!,
  });
  return { bridge, provider };
}

test('a stop before fake WebSocket registration is reasserted for only the retired request after acknowledgment', async () => {
  const { bridge, provider } = setup();
  const stop = new AbortController();
  const old = provider.generate(baseRequest, {
    signal: stop.signal,
    midTurnSteering: steering,
  });
  await bridge.waiting.promise;
  stop.abort();
  await expect(old).resolves.toMatchObject({ ok: false });
  expect(bridge.cancelled).toEqual(['first']);

  const ready = latch();
  const successor = provider.generate(baseRequest, {
    midTurnSteering: { ...steering, onReady: ready.release },
  });
  await ready.promise;
  bridge.registration.release();
  await bridge.firstAck.promise;
  // Cross the bridge promise's acknowledgment continuation, not a timed delay.
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(bridge.active.has('second')).toBe(true);

  // A buffered old terminal frame must not settle the new request or donate usage.
  bridge.emit({
    requestId: 'first',
    type: 'completed',
    text: 'Old synthetic terminal',
    usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11, cachedInputTokens: 9 },
  });
  bridge.finish('second', 'New synthetic result', 0);
  await expect(successor).resolves.toMatchObject({
    ok: true,
    value: { text: 'New synthetic result', usage: { cachedInputTokens: 0 } },
  });
  expect(bridge.cancelled).toEqual(['first', 'first']);
  expect(bridge.active.size).toBe(0);
  expect(bridge.started).toEqual([]);
  const [first, second] = bridge.requested;
  expect(bridge.requested.map(({ id }) => id)).toEqual(['first', 'second']);
  expect(first?.account).toBe(second?.account);
  expect(first?.request.transportScope).toBeTruthy();
  expect(second?.request).toEqual(first?.request);
});

test('a stop after known fake WebSocket registration sends only one cancellation', async () => {
  const { bridge, provider } = setup();
  const stop = new AbortController();
  const ready = latch();
  const current = provider.generate(baseRequest, {
    signal: stop.signal,
    midTurnSteering: { ...steering, onReady: ready.release },
  });
  await bridge.waiting.promise;
  bridge.registration.release();
  await ready.promise;
  stop.abort();
  await expect(current).resolves.toMatchObject({ ok: false });
  expect(bridge.cancelled).toEqual(['first']);
  expect(bridge.active.size).toBe(0);
  expect(bridge.requested).toHaveLength(1);
  expect(bridge.started).toEqual([]);
});
