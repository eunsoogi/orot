import { createChatGPTPlanProvider } from '../src';
import { baseRequest, FakeBridge } from './providerTestSupport';

test('aborts a pending native response once without waiting for the next stream event', async () => {
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const bridge = new FakeBridge(async () => {
    started();
    await new Promise(() => {});
  });
  const provider = createChatGPTPlanProvider({
    bridge,
    issuedClientID: 'synthetic',
    model: { slug: 'chosen-model', displayName: 'Chosen' },
    requestIDFactory: () => 'cancel-this-request',
  });
  const controller = new AbortController();
  const pending = provider.generate(baseRequest, { signal: controller.signal });
  await waiting;
  controller.abort();
  await expect(pending).resolves.toMatchObject({ ok: false });
  expect(bridge.cancelled).toEqual(['cancel-this-request']);
});

test('does not start inference for an already aborted caller', async () => {
  const bridge = new FakeBridge();
  const provider = createChatGPTPlanProvider({
    bridge,
    issuedClientID: 'synthetic',
    model: { slug: 'chosen-model', displayName: 'Chosen' },
  });
  const controller = new AbortController();
  controller.abort();
  await provider.generate(baseRequest, { signal: controller.signal });
  expect(bridge.started).toEqual([]);
  expect(bridge.cancelled).toEqual([]);
});
