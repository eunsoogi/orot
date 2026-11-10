import { decodeConversationArtifact } from '../conversationArtifactCodec';

const base = {
  id: 'turn',
  sessionId: 'session',
  createdAt: '2026-10-05T00:00:00.000Z',
  providerId: 'provider',
  modelId: 'model',
  status: 'complete',
  question: 'question',
  answer: 'answer',
  sources: [],
  citations: [],
};
const decode = (extra: object) =>
  decodeConversationArtifact(JSON.stringify({ ...base, ...extra }));
const turn = (length: number) => ({
  question: 'q'.repeat(length),
  answer: 'a'.repeat(length),
});

test('accepts valid dialogue and report bounds', () => {
  expect(
    decode({
      entryIntent: 'possibilities',
      priorDialogue: Array(4).fill(turn(1000)),
      priorUserReports: Array(8).fill('r'.repeat(2000)),
      priorDialogueOmitted: true,
    }),
  ).not.toBeNull();
});

test.each([
  { entryIntent: 'other' },
  { entryIntent: 3 },
  { priorDialogue: {} },
  { priorDialogue: Array(5).fill(turn(1)) },
  { priorDialogue: [turn(1001)] },
  { priorDialogue: [{ question: 1, answer: 'a' }] },
  { priorUserReports: 'report' },
  { priorUserReports: Array(9).fill('r') },
  { priorUserReports: ['r'.repeat(2001)] },
  { priorUserReports: [1] },
  { priorDialogueOmitted: false },
])('rejects malformed or excessive saved dialogue: %p', extra => {
  expect(decode(extra)).toBeNull();
});
