import { restoreConversationTask } from '../conversationTaskVersions';
import { runRagConversationTurn } from '../service';
import { conversationTaskV26, ragConversationTask } from '../task';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';

const routine = 'I practice the guitar every Monday.';
const preference = 'For future replies, I prefer concise answers.';
const input = {
  request: `내 최근 기록 알려 줘. ${routine} ${preference}`,
  evidence: { items: [], coverage: [], conflicts: [] },
};

// Run the real task and workflow against the fixture's local synthetic provider.
jest.mock('../../aiFeatures/integration/deletionAwareEvidence', () => ({
  revalidateWithLocalDeletionGuard: async () => true,
}));

test('restores the exact v26 schema rather than retroactively admitting new advice', () => {
  const restored = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '26',
  });
  expect(restored).toBe(conversationTaskV26);
  expect(restored?.createResultSchema?.(input)).toEqual(
    ragConversationTask.createResultSchema?.(input),
  );
});

test.each([
  [routine, 'authoredRoutineSpan'],
  [preference, 'replyPreferenceSpan'],
  ['I practice the piano every Monday.', null],
  [undefined, null],
] as const)('carries only a validated current span: %s', async (span, key) => {
  const f = fixture();
  f.generate.mockReset().mockResolvedValueOnce(
    response({
      type: 'result',
      value: {
        answerKind: 'grounded',
        answer: '기록에 증상이 있어요.',
        ...(span ? { authoredMemorySpan: span } : {}),
      },
      citations: ['synthetic-evidence'],
    }),
  );
  const result = await runRagConversationTurn({
    ...f.options,
    question: input.request,
  });
  expect(result).toMatchObject({
    status: 'answer',
    citations: [expect.objectContaining({ evidenceId: 'synthetic-evidence' })],
  });
  for (const name of ['authoredRoutineSpan', 'replyPreferenceSpan']) {
    if (name === key) expect(result).toHaveProperty(name, span);
    else expect(result).not.toHaveProperty(name);
  }
  expect(f.generate).toHaveBeenCalledTimes(1);
});
