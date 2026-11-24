import { recordingClarificationForLiveTurn } from '../conversationRecordingClarification';
import { failureFromWorkflow } from '../outcome';

const timestamp = '2026-02-01T12:30:00+09:00';
const recipient = {
  providerId: 'fake',
  modelId: 'fake',
  recipient: 'example',
  remoteProcessing: true,
};
const original = 'What was said in the recording?';
function harness() {
  const owner = {};
  let invalidate: (() => void) | undefined;
  let active = true;
  let protectedNow = true;
  const turn = (question: string, key = 'same') =>
    recordingClarificationForLiveTurn(owner, 1, {
      key,
      question,
      current: () => active,
      protectedCurrent: async () => protectedNow,
      subscribeInvalidation: callback => {
        invalidate = callback;
        return () => {
          invalidate = undefined;
        };
      },
    });
  return {
    turn,
    invalidate: () => invalidate?.(),
    hide: () => (active = false),
    lock: () => (protectedNow = false),
  };
}

it('keeps original question separate and consumes the receipt only once', async () => {
  const { turn } = harness();
  const request = turn(original);
  expect(await request.stage(recipient)).toBe(true);
  expect(await request.stage(recipient)).toBe(false);
  const reply = turn(timestamp).reply;
  expect(reply).toMatchObject({
    originalQuestion: original,
    exactUserTimestamp: timestamp,
    recipient,
  });
  expect(reply?.claim()).toBe(true);
  expect(reply?.claim()).toBe(false);
  expect(turn(timestamp).reply).toBeUndefined();
});

it.each([
  'Do not use ' + timestamp,
  '2026-02-01T12:30:00',
  timestamp + ' or another',
])('retires the receipt without admitting nonexact input %s', async text => {
  const { turn } = harness();
  expect(await turn(original).stage(recipient)).toBe(true);
  expect(turn(text).reply).toBeUndefined();
  expect(turn(timestamp).reply).toBeUndefined();
});

it.each(['invalidate', 'hide', 'replace'] as const)(
  'rejects %s before the reply',
  async state => {
    const h = harness();
    expect(await h.turn(original).stage(recipient)).toBe(true);
    if (state !== 'replace') h[state]();
    expect(
      h.turn(timestamp, state === 'replace' ? 'other' : undefined).reply,
    ).toBeUndefined();
  },
);

it('requires native protection before staging a receipt', async () => {
  const h = harness();
  h.lock();
  expect(await h.turn(original).stage(recipient)).toBe(false);
  expect(h.turn(timestamp).reply).toBeUndefined();
});

it('uses typed provenance, never reason text, for recording guidance', () => {
  const result = {
    status: 'needs_clarification',
    reason: 'A specific saved recording is required.',
  } as const;
  expect(failureFromWorkflow(result as never)).toEqual({
    status: 'insufficient',
  });
  expect(
    failureFromWorkflow({
      ...result,
      clarification: 'recording_selector_required',
    } as never),
  ).toEqual({
    status: 'insufficient',
    guidance: 'recording_selector',
  });
});
