import { finishConversationWorkflow } from '../finishConversationWorkflow';
import { createConversationRetentionBridge } from '../conversationRetentionBridge';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { captureConversationSources } from '../captureConversationSources';
import { providerDiagnostic } from '../../../providers/diagnostics';

jest.mock('../captureConversationSources', () => ({
  captureConversationSources: jest.fn(),
}));
jest.mock('../../../providers/diagnostics', () => ({
  providerDiagnostic: jest.fn(),
}));
const diagnostic = jest.mocked(providerDiagnostic);
const capture = jest.mocked(captureConversationSources);
const captured = () => ({ sources: [], mapping: new Map() });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(historyIsCurrent: () => Promise<boolean>) {
  const controller = new AbortController();
  const save = jest.fn(async () => {});
  const failed = jest.fn();
  const retention = createConversationRetentionBridge({
    observer: { onRetentionCandidate: save, onRetentionFailure: failed },
    registry: new LocalEvidenceReferenceRegistry(),
    question: 'PRIVATE_QUESTION',
    providerId: 'PRIVATE_PROVIDER',
    modelId: 'PRIVATE_MODEL',
    signal: controller.signal,
  });
  retention.onValidatedEvidence([]);
  const run = () =>
    finishConversationWorkflow({
      outcome: { status: 'answer', answer: 'PRIVATE_ANSWER', citations: [] },
      generated: {
        choose: () => null,
        tools: [],
        artifactPagingSnapshot: undefined,
        researchPagingSnapshot: undefined,
        hasUnsupportedPagingState: () => false,
        hasPagingState: () => false,
        coldPaging: () => ({
          hasPagingState: false,
          researchPaging: undefined,
          artifactPaging: undefined,
        }),
      },
      localRetrievalFailed: () => false,
      historyIsCurrent,
      publicSearch: { status: 'success' },
      retention,
      signal: controller.signal,
    });
  return { run, controller, save, failed };
}
beforeEach(() => {
  jest.resetAllMocks();
  capture.mockResolvedValue(captured());
});

// These boundaries wrap the real finish/capture awaits, not an imitation pipeline.
test('separates final history and capture waits before saving without logging content or IDs', async () => {
  const history = deferred<boolean>();
  const source = deferred<ReturnType<typeof captured>>();
  capture.mockReturnValue(source.promise);
  const f = fixture(() => history.promise);
  const pending = f.run();
  expect(diagnostic.mock.calls).toEqual([
    ['rag', 'conversation_final_history_validation', 'started'],
  ]);
  expect(capture).not.toHaveBeenCalled();
  history.resolve(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.save).not.toHaveBeenCalled();
  expect(diagnostic.mock.calls).toEqual([
    ['rag', 'conversation_final_history_validation', 'started'],
    ['rag', 'conversation_final_history_validation', 'completed'],
    ['rag', 'conversation_retention_capture', 'started'],
  ]);
  source.resolve(captured());
  expect((await pending).status).toBe('answer');
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(diagnostic.mock.calls.at(-1)).toEqual([
    'rag',
    'conversation_retention_capture',
    'completed',
  ]);
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('PRIVATE_');
});

test('history exceptions propagate unchanged while false validity never starts capture', async () => {
  const error = new Error('PRIVATE_ERROR');
  await expect(
    fixture(async () => {
      throw error;
    }).run(),
  ).rejects.toBe(error);
  expect(diagnostic.mock.calls.at(-1)).toEqual([
    'rag',
    'conversation_final_history_validation',
    'failed',
  ]);
  expect(await fixture(async () => false).run()).toEqual({
    status: 'failure',
    kind: 'retrieval_failed',
  });
  expect(capture).not.toHaveBeenCalled();
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('PRIVATE_');
});

test('capture failure keeps the existing unsaved-answer recovery and logs no exception', async () => {
  capture.mockRejectedValue(new Error('PRIVATE_CAPTURE_ERROR'));
  const f = fixture(async () => true);
  expect((await f.run()).status).toBe('answer');
  expect(f.failed).toHaveBeenCalledTimes(1);
  expect(f.save).not.toHaveBeenCalled();
  expect(diagnostic.mock.calls.at(-1)).toEqual([
    'rag',
    'conversation_retention_capture',
    'failed',
  ]);
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('PRIVATE_');
});

test('Stop during capture still prevents save and preserves cancellation', async () => {
  const source = deferred<ReturnType<typeof captured>>();
  capture.mockReturnValue(source.promise);
  const f = fixture(async () => true);
  const pending = f.run();
  await new Promise(resolve => setTimeout(resolve, 0));
  f.controller.abort();
  source.resolve(captured());
  expect(await pending).toEqual({ status: 'failure', kind: 'cancelled' });
  expect(f.save).not.toHaveBeenCalled();
  expect(f.failed).not.toHaveBeenCalled();
});

test('diagnostic sink failures cannot prevent valid capture or saving', async () => {
  diagnostic.mockImplementation(() => {
    throw new Error('PRIVATE_SINK');
  });
  const f = fixture(async () => true);
  expect((await f.run()).status).toBe('answer');
  expect(f.save).toHaveBeenCalledTimes(1);
});
