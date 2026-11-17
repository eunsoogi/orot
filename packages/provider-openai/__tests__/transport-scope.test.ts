import { createChatGPTPlanProvider } from '../src/provider';
import { FakeBridge, baseRequest } from './providerTestSupport';

test('scope is stable only within one provider lifetime and never changes approved inputs', async () => {
  const bridge = new FakeBridge(async (requestId, target) => {
    target.emit({ requestId, type: 'completed', text: '' });
  });
  const options = {
    bridge,
    issuedClientID: 'synthetic',
    model: { slug: 'synthetic', displayName: 'Synthetic' },
  };
  const first = createChatGPTPlanProvider(options);
  const second = createChatGPTPlanProvider(options);
  await first.generate(baseRequest);
  await first.generate(baseRequest);
  await second.generate(baseRequest);
  const [a, b, c] = bridge.started.map((value) => value.request);
  expect(a.transportScope).toBeTruthy();
  expect(b.transportScope).toBe(a.transportScope);
  expect(c.transportScope).not.toBe(a.transportScope);
  expect(b.messages).toEqual(a.messages);
  expect(c.messages).toEqual(a.messages);
  expect(JSON.stringify(a)).not.toContain('previous_response_id');
});
