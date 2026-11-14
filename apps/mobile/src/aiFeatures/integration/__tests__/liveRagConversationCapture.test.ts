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

// The production capture closure preserves the completed preflight, not its dispatch function.
test.each(['success', 'empty', 'consent_required'] as const)(
  'preserves eager %s on the protected reconstruction',
  async status => {
    const publicSearch = { version: 1 as const, status, charged: true };
    const result = await liveRagConversationCapture(state, () => ({
      ...completion,
      publicSearch,
    }))(input);
    expect(result.publicSearch).toEqual(publicSearch);
    expect(JSON.parse(JSON.stringify(result)).publicSearch).toEqual(
      publicSearch,
    );
  },
);

// Only the protected snapshot crosses capture; the live closure is never serialized.
test('captures supported research paging with the original run and no stored function', async () => {
  const paging = {
    version: 1 as const,
    sequence: 1,
    tokens: [
      {
        token: 'research-page-1',
        query: 'synthetic',
        scope: 'original-run',
        cursor: 'research-9',
      },
    ],
  };
  const snapshot = jest.fn(() => paging);
  await liveRagConversationCapture(state, () => ({
    ...completion,
    researchPaging: snapshot,
  }))(input);
  expect(snapshot).toHaveBeenCalledWith('original-run');
  expect(capture).toHaveBeenCalledWith(
    expect.objectContaining({ researchPaging: paging }),
  );
});
