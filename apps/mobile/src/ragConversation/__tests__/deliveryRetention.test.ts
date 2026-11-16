import { createConversationTurnRetention } from '../conversationTurnRetention';
import { decodeConversationArtifact } from '../../storage/conversationArtifactCodec';
import type { ConversationArtifact } from '../../storage/conversationArtifactTypes';

const delivery = {
  submittedAt: '2026-10-05T00:00:00.000Z',
  acceptedAt: '2026-10-05T00:00:01.000Z',
  readAt: '2026-10-05T00:00:02.000Z',
};
const candidate = {
  question: 'synthetic question',
  answer: 'synthetic answer',
  providerId: 'p',
  modelId: 'm',
  sources: [],
  citations: [],
};
function fixture() {
  const append = jest.fn(async (_value: ConversationArtifact) => {});
  const turn = createConversationTurnRetention({
    storage: { append },
    sessionId: 'session',
    turnId: 'turn',
    createdAt: delivery.submittedAt,
  });
  return { append, turn };
}

test('first receipt observations survive save retry without replacing opening or answer', async () => {
  const { append, turn } = fixture();
  append.mockRejectedValueOnce(new Error('synthetic write failure'));
  turn.retainDelivery(delivery);
  turn.retainDelivery({
    submittedAt: delivery.submittedAt,
    acceptedAt: '2026-10-05T00:01:00.000Z',
  });
  const opening = { callId: 'opening', text: '살펴볼게요.' };
  turn.retainOpening(opening);
  await expect(
    turn.save(candidate, new AbortController().signal),
  ).rejects.toThrow();
  await turn.retry();
  expect(append.mock.calls[1]![0]).toMatchObject({
    ...candidate,
    delivery,
    initialResponse: opening,
  });
});

test('source revocation strips a failed save and rejects late receipt recapture', async () => {
  const { append, turn } = fixture();
  append.mockRejectedValueOnce(new Error('synthetic write failure'));
  turn.retainDelivery(delivery);
  await expect(
    turn.save(candidate, new AbortController().signal),
  ).rejects.toThrow();
  turn.discardOpening();
  turn.retainDelivery(delivery);
  await turn.retry();
  expect(append.mock.calls[1]![0]).toMatchObject(candidate);
  expect(append.mock.calls[1]![0].delivery).toBeUndefined();
});

test('revocation before deferred materialization cannot revive receipts', async () => {
  const { append, turn } = fixture();
  turn.retainDelivery(delivery);
  turn.defer(async () => candidate);
  turn.discardOpening();
  turn.retainDelivery(delivery);
  await turn.retry();
  expect(append.mock.calls[0]![0]).not.toHaveProperty('delivery');
});

test('untrusted malformed optional delivery is omitted without losing the final artifact', () => {
  for (const invalid of [
    null,
    'bad',
    { submittedAt: 'not a time' },
    { submittedAt: delivery.submittedAt, readAt: delivery.readAt },
    { ...delivery, extra: 'private' },
  ]) {
    const artifact = decodeConversationArtifact(
      JSON.stringify({
        ...candidate,
        id: 'turn',
        sessionId: 'session',
        createdAt: delivery.submittedAt,
        status: 'complete',
        delivery: invalid,
      }),
    );
    expect(artifact).toMatchObject(candidate);
    expect(artifact).not.toHaveProperty('delivery');
  }
});
