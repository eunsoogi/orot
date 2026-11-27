import { MemorySaver } from '@langchain/langgraph/web';
import type { LanguageModelRequest } from '@orot/model-runtime';
import type { OutboundProcessingRequest } from '../src';
import { createMultiAgentPauseController } from '../src';
import { journaledModelCall } from '../src/multiAgent/journaledModelCall';
import type { RuntimeContext } from '../src/multiAgent/runtimeContext';
import { makeProvider, workflowOptions } from './multiAgent-external-evidence-fixtures';
import { operationJournalFixture } from './workflow-operation-journal-fixture';

function fixture() {
  const initial = makeProvider(['one', 'two']);
  const incoming: (AbortSignal | undefined)[] = [];
  const changes = new Set<() => void>();
  let account = 'selected-account';
  let onTransport = () => {};
  const provider = {
    ...initial.provider,
    generate: jest.fn<
      ReturnType<typeof initial.provider.generate>,
      Parameters<typeof initial.provider.generate>
    >((request, options) => {
      incoming.push(options?.signal);
      onTransport();
      return initial.generate(request);
    }),
  };
  const { journal, records } = operationJournalFixture();
  const options = {
    ...workflowOptions(provider, {} as never),
    checkpointer: new MemorySaver(),
    operationJournal: journal,
  };
  const caller = new AbortController();
  const pause = createMultiAgentPauseController();
  const context = {
    options,
    currentEvidence: { items: [] },
    signal: caller.signal,
    pause,
    activeModelOperation: { operationKey: 'model', callIndex: 0 },
  } as unknown as RuntimeContext<unknown>;
  const consent = {
    authorize: jest.fn(async (request: OutboundProcessingRequest) =>
      request.recipient === account ? ('authorized' as const) : ('renewal_required' as const),
    ),
    isAuthorizationCurrent: (request: OutboundProcessingRequest) => request.recipient === account,
    subscribeAuthorizationInvalidation(_request: OutboundProcessingRequest, listener: () => void) {
      changes.add(listener);
      return () => {
        changes.delete(listener);
      };
    },
  };
  const send = (text: string) => {
    const request: LanguageModelRequest = { messages: [{ role: 'user', content: text }] };
    return journaledModelCall(context, request, consent);
  };
  return {
    caller,
    context,
    consent,
    records,
    send,
    incoming,
    provider,
    changeRecipient() {
      account = 'replacement-account';
      for (const listener of [...changes]) listener();
    },
    onTransport(callback: () => void) {
      onTransport = callback;
    },
  };
}

test('separate exact approval signals preserve one canonical post-approval provider lifetime', async () => {
  const f = fixture();
  try {
    expect(await f.send('First request')).toMatchObject({ status: 'response' });
    const second = await f.send('Second request');
    expect(second).toMatchObject({ status: 'response' });
    expect(f.consent.authorize).toHaveBeenCalledTimes(2);
    const [first, next] = f.consent.authorize.mock.calls.map((args) => args[0].signal);
    expect(first).not.toBe(next);
    expect(Object.is(f.incoming[0], f.incoming[1])).toBe(true);
    expect(f.incoming[0]).not.toBe(first);
    expect(f.incoming[0]?.aborted).toBe(false);
    f.context.activeModelOperation!.callIndex = 1;
    expect(await f.send('Second request')).toMatchObject(second!);
    expect(f.provider.generate).toHaveBeenCalledTimes(2);
    expect(f.consent.authorize).toHaveBeenCalledTimes(2);
  } finally {
    f.caller.abort();
  }
  expect(f.incoming[0]?.aborted).toBe(true);
});

test.each(['during-dispatch', 'after-return'] as const)(
  'recipient change %s invalidates the exact provider owner without replay',
  async (timing) => {
    const f = fixture();
    if (timing === 'during-dispatch') f.onTransport(f.changeRecipient);
    try {
      const first = await f.send('First request');
      expect(first).toMatchObject({
        status: timing === 'during-dispatch' ? 'consent_required' : 'response',
      });
      if (timing === 'after-return') f.changeRecipient();
      expect(f.incoming[0]?.aborted).toBe(true);
      expect(await f.send('Second request')).toMatchObject({ status: 'consent_required' });
      expect(f.provider.generate).toHaveBeenCalledTimes(1);
      expect(f.records.get('model:call-1')?.state.status).toBe(
        timing === 'during-dispatch' ? 'pending' : 'completed',
      );
      if (timing === 'during-dispatch') {
        f.context.activeModelOperation!.callIndex = 0;
        expect(await f.send('First request')).toMatchObject({ status: 'unavailable' });
        expect(f.provider.generate).toHaveBeenCalledTimes(1);
      }
    } finally {
      f.caller.abort();
    }
  },
);
