import { describe, expect, it, jest } from '@jest/globals';
import type { LanguageModelExecutionOptions } from '@orot/model-runtime';
import { createChatGPTPlanProvider } from '../src';
import type { ChatGPTPlanRequest } from '../src';
import { baseRequest, FakeBridge } from './providerTestSupport';

type Control = Parameters<
  NonNullable<LanguageModelExecutionOptions['midTurnSteering']>['onReady']
>[0];
class SteeringBridge extends FakeBridge {
  readonly steeringStarts: string[] = [];
  readonly submissions: { id: string; text: string }[] = [];
  async startSteerableResponse(id: string, _account: string, _request: ChatGPTPlanRequest) {
    this.steeringStarts.push(id);
    this.emit({ requestId: id, type: 'steering_ready' });
    this.emit({ requestId: id, type: 'text_delta', text: 'Before' });
  }
  async steerResponse(requestId: string, id: string, text: string) {
    this.submissions.push({ id, text });
    this.emit({ requestId, type: 'steering', submissionId: id, status: 'accepted' });
  }
}
const model = { slug: 'gpt-6', displayName: 'Synthetic model', supportsMidTurnSteering: true };
function setup(onEvent = jest.fn(async (_event: { id: string; status: string }) => {})) {
  const bridge = new SteeringBridge();
  const provider = createChatGPTPlanProvider({
    bridge,
    model,
    issuedClientID: 'synthetic',
    requestIDFactory: () => 'request',
  });
  let control: Control | undefined;
  const stream = provider.stream!(baseRequest, {
    midTurnSteering: {
      onReady: (value) => {
        control = value;
      },
      onEvent,
    },
  })[Symbol.asyncIterator]();
  return { bridge, provider, stream, control: () => control!, onEvent };
}

describe('same-connection steering adapter', () => {
  it('keeps ordinary requests on SSE even when the optional transport exists', async () => {
    const bridge = new SteeringBridge(async (id, target) =>
      target.emit({ requestId: id, type: 'completed', text: '' }),
    );
    const provider = createChatGPTPlanProvider({ bridge, model, issuedClientID: 'synthetic' });
    expect((await provider.generate(baseRequest)).ok).toBe(true);
    expect(bridge.started).toHaveLength(1);
    expect(bridge.steeringStarts).toHaveLength(0);
  });

  it('does not expose eligibility or silently replay an explicit unsupported WS request over SSE', async () => {
    const bridge = new SteeringBridge();
    const provider = createChatGPTPlanProvider({
      bridge,
      model: { slug: 'gpt-6', displayName: 'Unknown eligibility' },
      issuedClientID: 'synthetic',
    });
    expect(provider.capabilities.midTurnSteering).toBeUndefined();
    const onReady = jest.fn();
    const result = await provider.generate(baseRequest, {
      midTurnSteering: { onReady, onEvent: async () => {} },
    });
    expect(result.ok).toBe(false);
    expect(onReady).not.toHaveBeenCalled();
    expect(bridge.started).toHaveLength(0);
    expect(bridge.steeringStarts).toHaveLength(0);
  });

  it('awaits accepted and applied persistence before successor output and completion', async () => {
    let release!: () => void;
    const events: string[] = [];
    const fixture = setup(
      jest.fn(async (event) => {
        events.push(event.status);
        if (event.status === 'accepted')
          await new Promise<void>((resolve) => {
            release = resolve;
          });
      }),
    );
    expect(fixture.control()).toBeUndefined();
    await fixture.stream.next();
    await fixture.control().submit('s1', 'Use the new constraint');
    fixture.bridge.emit({
      requestId: 'request',
      type: 'steering',
      submissionId: 's1',
      status: 'applied',
    });
    fixture.bridge.emit({ requestId: 'request', type: 'text_snapshot', text: '' });
    fixture.bridge.emit({ requestId: 'request', type: 'text_delta', text: 'After' });
    fixture.bridge.emit({ requestId: 'request', type: 'completed', text: 'After' });
    let settled = false;
    const next = fixture.stream.next().then((value) => {
      settled = true;
      return value;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual(['accepted']);
    expect(settled).toBe(false);
    release();
    expect((await next).value).toEqual({ ok: true, value: { type: 'text_snapshot', text: '' } });
    expect(events).toEqual(['accepted', 'applied']);
    await fixture.stream.next();
    expect((await fixture.stream.next()).value).toMatchObject({
      ok: true,
      value: { type: 'completed', response: { text: 'After' } },
    });
    await expect(fixture.control().submit('s2', 'Too late')).rejects.toThrow();
    expect(fixture.bridge.submissions).toHaveLength(1);
  });

  it('retains accepted/pending as uncommitted on disconnect, without retry or SSE fallback', async () => {
    const f = setup();
    await f.stream.next();
    await f.control().submit('s1', 'New instruction');
    await expect(f.control().submit('s1', 'New instruction')).rejects.toThrow();
    f.bridge.emit({
      requestId: 'request',
      type: 'steering',
      submissionId: 's1',
      status: 'pending',
    });
    f.bridge.emit({ requestId: 'request', type: 'failed', error: { kind: 'transport' } });
    expect((await f.stream.next()).value).toMatchObject({ ok: false });
    expect(f.onEvent.mock.calls.map((call) => call[0].status)).toEqual(['accepted', 'pending']);
    expect(f.bridge.submissions).toHaveLength(1);
    expect(f.bridge.started).toHaveLength(0);
    await expect(f.control().submit('s2', 'Retry')).rejects.toThrow();
  });

  it('rejects a foreign acknowledgement instead of attaching it to another user submission', async () => {
    const f = setup();
    await f.stream.next();
    await f.control().submit('s1', 'New instruction');
    f.bridge.emit({
      requestId: 'request',
      type: 'steering',
      submissionId: 'foreign',
      status: 'applied',
    });
    expect((await f.stream.next()).value).toMatchObject({ ok: false });
    expect(f.onEvent.mock.calls.map((call) => call[0].status)).toEqual(['accepted']);
    expect(f.bridge.cancelled).toEqual(['request']);
  });

  it('does not resend after an ambiguous bridge rejection', async () => {
    const f = setup();
    await f.stream.next();
    f.bridge.steerResponse = jest.fn(async () => {
      throw new Error('Socket lost');
    });
    await expect(f.control().submit('s1', 'New instruction')).rejects.toThrow('Socket lost');
    await expect(f.control().submit('s1', 'New instruction')).rejects.toThrow();
    expect(f.bridge.steerResponse).toHaveBeenCalledTimes(1);
    expect(f.onEvent).not.toHaveBeenCalled();
    await f.stream.return?.();
  });

  it('does not expose completion when acknowledgement persistence fails', async () => {
    const f = setup(
      jest.fn(async () => {
        throw new Error('Synthetic save failure');
      }),
    );
    await f.stream.next();
    await f.control().submit('s1', 'New instruction');
    f.bridge.emit({ requestId: 'request', type: 'completed', text: 'Before' });
    expect((await f.stream.next()).value).toMatchObject({ ok: false });
    expect(f.bridge.cancelled).toEqual(['request']);
    await expect(f.control().submit('s2', 'Retry')).rejects.toThrow();
  });

  it('keeps a committed instruction applied when the successor disconnects', async () => {
    const f = setup();
    await f.stream.next();
    await f.control().submit('s1', 'New instruction');
    f.bridge.emit({
      requestId: 'request',
      type: 'steering',
      submissionId: 's1',
      status: 'applied',
    });
    f.bridge.emit({ requestId: 'request', type: 'failed', error: { kind: 'transport' } });
    expect((await f.stream.next()).value).toMatchObject({ ok: false });
    expect(f.onEvent.mock.calls.map((call) => call[0].status)).toEqual(['accepted', 'applied']);
    expect(f.bridge.submissions).toHaveLength(1);
  });
});
