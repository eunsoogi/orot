import { liveRagConversationCapture } from '../liveRagConversationCapture';
import { captureColdRagConversationState } from '../coldRagConversationState';

jest.mock('../coldRagConversationState', () => ({
  captureColdRagConversationState: jest.fn(async () => ({
    factoryVersion: 'synthetic',
  })),
}));
const capture = jest.mocked(captureColdRagConversationState);
const state = {
  registry: {},
  tracker: {},
  external: {},
  sessionId: 'original-session',
  signal: new AbortController().signal,
} as Parameters<typeof liveRagConversationCapture>[0];
const completion = {
  history: {
    priorTurns: [{ question: 'earlier', answer: 'bounded' }],
    reports: ['report'],
    omitted: true,
    sources: [],
  },
  reportReferences: [],
  localRetrievalFailed: true,
  hasPagingState: false,
} as unknown as ReturnType<Parameters<typeof liveRagConversationCapture>[1]>;
const input = {
  options: { execution: { operationRunId: 'original-run' } },
  evidenceBatches: [{ items: [], coverage: [], conflicts: [] }],
  knownCallIds: ['protected-call'],
} as unknown as Parameters<ReturnType<typeof liveRagConversationCapture>>[0];
beforeEach(() => capture.mockClear());

test('captures exact bounded completion lineage and original owner without persisted closures', async () => {
  const value = await liveRagConversationCapture(
    state,
    () => completion,
  )(input);
  expect(capture).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: 'original-session',
      operationRunId: 'original-run',
      knownCallIds: ['protected-call'],
      batches: input.evidenceBatches,
    }),
  );
  expect(value.completion).toEqual({
    version: 1,
    entryContext: null,
    priorDialogue: completion.history.priorTurns,
    priorUserReports: ['report'],
    priorDialogueOmitted: true,
    historySources: [],
    reportReferences: [],
    localRetrievalFailed: true,
  });
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
});

test('unsupported paging refuses cold capture rather than losing its cursor or repeating a search', async () => {
  await expect(
    liveRagConversationCapture(state, () => ({
      ...completion,
      hasPagingState: true,
    }))(input),
  ).rejects.toThrow('paging');
  expect(capture).not.toHaveBeenCalled();
});
