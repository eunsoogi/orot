import type { ConversationArtifact } from '../../storage/conversationArtifactTypes';
import { createConversationTurnRetention } from '../conversationTurnRetention';

const candidate = {
  question: 'q',
  answer: 'a',
  providerId: 'p',
  modelId: 'm',
  sources: [],
  citations: [],
};
const opening = { callId: 'opening', text: '질문에 맞춰 살펴볼게요.' };
function fixture(append = jest.fn(async (_value: ConversationArtifact) => {})) {
  return {
    append,
    turn: createConversationTurnRetention({
      storage: { append },
      sessionId: 'session',
      turnId: 'turn',
      createdAt: '2026-10-05T00:00:00.000Z',
    }),
  };
}

test('invalid optional opening cannot prevent final answer persistence', async () => {
  const { turn, append } = fixture();
  turn.retainOpening({ ...opening, callId: 'x'.repeat(201) });
  await turn.save(candidate, new AbortController().signal);
  expect(append.mock.calls[0]![0]).toMatchObject({ answer: 'a' });
  expect(append.mock.calls[0]![0]).not.toHaveProperty('initialResponse');
});

test('revocation clears failed-save metadata and fences late recapture', async () => {
  const append = jest.fn(async (_value: ConversationArtifact) => {});
  append.mockRejectedValueOnce(new Error('synthetic write failure'));
  const { turn } = fixture(append);
  turn.retainOpening(opening);
  await expect(
    turn.save(candidate, new AbortController().signal),
  ).rejects.toThrow();
  turn.discardOpening();
  turn.retainOpening({ ...opening, text: 'late' });
  await turn.retry();
  expect(append.mock.calls[1]![0]).toMatchObject({ answer: 'a' });
  expect(append.mock.calls[1]![0].initialResponse).toBeUndefined();
});
