import type {
  OutboundProcessingRequest,
  ConsentDecision,
} from '@orot/agent-runtime';
import { withConcurrentConversationOpening } from '../concurrentConversationOpening';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function setup() {
  const owner = new AbortController();
  const finalDecision = deferred<ConsentDecision>();
  const openingDecision = deferred<ConsentDecision>();
  const onTimeout = jest.fn();
  const provider = jest.fn();
  const authorize = jest.fn((request: OutboundProcessingRequest) =>
    request.operationRunId === 'final'
      ? finalDecision.promise
      : openingDecision.promise,
  );
  let openingSignal!: AbortSignal;
  const makeRequest = (id: string, signal: AbortSignal) =>
    ({
      operationRunId: id,
      signal,
      payload: { synthetic: id },
    }) as unknown as OutboundProcessingRequest;
  const finalRequest = makeRequest('final', owner.signal);
  let openingRequest!: OutboundProcessingRequest;
  const completed = jest.fn();
  const result = withConcurrentConversationOpening({
    signal: owner.signal,
    consent: { authorize },
    onTimeout,
    run: async consent => {
      await consent.authorize(finalRequest);
      return 'final';
    },
    open: async (consent, signal) => {
      openingSignal = signal;
      openingRequest = makeRequest('opening', signal);
      const decision = await consent.authorize(openingRequest);
      if (decision === 'authorized' && !signal.aborted) provider();
    },
  }).then(completed);
  return {
    owner,
    finalDecision,
    openingDecision,
    authorize,
    onTimeout,
    provider,
    result,
    completed,
    finalRequest,
    openingRequest: () => openingRequest,
    openingSignal: () => openingSignal,
  };
}

afterEach(() => jest.useRealTimers());

test.each(['authorized', 'renewal_required'] as const)(
  'queued and visible decisions outlive the processing cap until explicit %s',
  async decision => {
    jest.useFakeTimers();
    const f = setup();
    await flush();
    expect(f.authorize).toHaveBeenCalledTimes(1);
    expect(f.authorize).toHaveBeenNthCalledWith(1, f.finalRequest);
    jest.advanceTimersByTime(20_000);
    await flush();
    expect(f.openingSignal().aborted).toBe(false);
    expect(f.onTimeout).not.toHaveBeenCalled();
    f.finalDecision.resolve('authorized');
    await flush();
    expect(f.authorize).toHaveBeenNthCalledWith(2, f.openingRequest());
    jest.advanceTimersByTime(20_000);
    await flush();
    expect(f.openingSignal().aborted).toBe(false);
    expect(f.completed).not.toHaveBeenCalled();
    f.openingDecision.resolve(decision);
    await f.result;
    expect(f.provider).toHaveBeenCalledTimes(decision === 'authorized' ? 1 : 0);
    expect(f.completed).toHaveBeenCalledWith('final');
    expect(f.onTimeout).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  },
);

test.each(['queued', 'visible'] as const)(
  'Stop during %s consent rejects late approval without provider work or a resurrected timer',
  async phase => {
    jest.useFakeTimers();
    const f = setup();
    await flush();
    if (phase === 'visible') {
      f.finalDecision.resolve('authorized');
      await flush();
    }
    f.owner.abort();
    expect(f.openingSignal().aborted).toBe(true);
    f.finalDecision.resolve('authorized');
    f.openingDecision.resolve('authorized');
    await f.result;
    await flush();
    expect(f.authorize).toHaveBeenCalledTimes(phase === 'visible' ? 2 : 1);
    expect(f.provider).not.toHaveBeenCalled();
    jest.advanceTimersByTime(20_000);
    expect(f.onTimeout).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  },
);
