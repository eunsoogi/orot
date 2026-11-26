import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import { modelResponseFixture } from '../../../agent/visitQuestions/testing/modelResponseFixture';
import { selectedOption } from '../../../agent/visitQuestions/testing/workflowFixtures';
import { startContextualConversationOpening } from '../contextualConversationOpening';

const opening = '기록의 흐름을 살펴볼게요.';

test.each(['held-journal', 'stop', 'committed'] as const)(
  'a reviewed on-device opening cannot block the grounded answer indefinitely: %s',
  async mode => {
    jest.useFakeTimers();
    const owner = new AbortController();
    let release!: () => void;
    const journal = new Promise<void>(resolve => {
      release = resolve;
    });
    let providerCalls = 0;
    let review!: () => void;
    const reviewWait = new Promise<void>(resolve => {
      review = resolve;
    });
    const provider = new AppleFoundationModelsProvider({
      getAvailability: async () => ({ status: 'available' }),
      async generate() {
        throw new Error('Expected the selected on-device stream');
      },
      async *stream() {
        const round = ++providerCalls;
        if (round === 2) await reviewWait;
        yield {
          type: 'completed',
          response: modelResponseFixture(round === 1 ? opening : 'ALLOW'),
        };
      },
      cancel: jest.fn(),
    });
    const { selection, option } = selectedOption(provider, 'on-device');
    const final = jest.fn();
    const settled = jest.fn();
    const display = jest.fn();
    const delivery = jest.fn(
      async (value: { text: string }, signal: AbortSignal) => {
        await journal;
        if (signal.aborted) return false;
        display(value.text);
        return true;
      },
    );
    const authorize = jest.fn(async () => 'renewal_required' as const);
    const work = startContextualConversationOpening({
      selected: {
        status: 'ready',
        selection,
        option,
        provider,
        modelId: selection.modelId,
        recipient: 'on-device',
        remoteProcessing: false,
      },
      request: '합성 기록 흐름을 살펴봐 줘',
      observer: { onTaskStreamEvent: jest.fn(), onReviewedOpening: delivery },
      consent: { authorize },
      consentScope: undefined,
      signal: owner.signal,
    });
    const grounded = work.done.then(() => {
      settled();
      if (!owner.signal.aborted) final();
    });
    try {
      await jest.advanceTimersByTimeAsync(0);
      expect(providerCalls).toBe(2);
      await jest.advanceTimersByTimeAsync(7_000);
      review();
      await jest.advanceTimersByTimeAsync(0);
      expect(delivery).toHaveBeenCalledTimes(1);
      expect(display).not.toHaveBeenCalled();
      expect(final).not.toHaveBeenCalled();
      if (mode === 'stop') owner.abort();
      else if (mode === 'committed') release();
      else {
        await jest.advanceTimersByTimeAsync(2_999);
        expect(settled).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
      }
      await jest.advanceTimersByTimeAsync(0);
      expect(display).toHaveBeenCalledTimes(mode === 'committed' ? 1 : 0);
      expect(settled).toHaveBeenCalledTimes(1);
      expect(final).toHaveBeenCalledTimes(mode === 'stop' ? 0 : 1);
      expect(delivery.mock.calls[0]?.[1].aborted).toBe(mode !== 'committed');
      release();
      await grounded;
      expect(display).toHaveBeenCalledTimes(mode === 'committed' ? 1 : 0);
      expect(authorize).not.toHaveBeenCalled();
    } finally {
      review();
      release();
      work.dispose();
      jest.useRealTimers();
    }
  },
);
