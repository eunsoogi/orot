import { createDailyReportIdentity } from '@orot/domain';
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

test('accepts complete dialogue and reports beyond legacy content ceilings', () => {
  expect(
    decode({
      entryIntent: 'possibilities',
      priorDialogue: Array(12).fill(turn(5000)),
      priorUserReports: Array(20).fill('r'.repeat(5000)),
      priorDialogueOmitted: true,
    }),
  ).not.toBeNull();
});

test.each([
  { entryIntent: 'other' },
  { entryIntent: 3 },
  { priorDialogue: {} },
  { priorDialogue: [{ question: 1, answer: 'a' }] },
  { priorUserReports: 'report' },
  { priorUserReports: [1] },
  { priorDialogueOmitted: false },
])('rejects malformed saved dialogue: %p', extra => {
  expect(decode(extra)).toBeNull();
});

test('validates report target strictly while accepting legacy turns', () => {
  const report = {
    identity: createDailyReportIdentity('2026-11-10', 'Asia/Seoul'),
    runId: 'run',
    revision: 1,
  };
  expect(decode({})).not.toBeNull();
  expect(decode({ dailyReport: report })).not.toBeNull();
  for (const dailyReport of [
    null,
    {},
    { ...report, prose: 'private' },
    { ...report, revision: 0 },
    { ...report, revision: 1.5 },
    { ...report, runId: '' },
    { ...report, identity: { ...report.identity, key: 'wrong' } },
  ])
    expect(decode({ dailyReport })).toBeNull();
});
