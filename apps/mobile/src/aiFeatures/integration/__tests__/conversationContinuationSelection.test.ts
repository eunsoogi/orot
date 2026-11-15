import { prepareConversationContinuation } from '../prepareConversationContinuation';
import type { SelectedAiResolution } from '../provider';
import type { RagConversationObserver } from '../../../ragConversation/conversationObserver';

jest.mock('../../../storage/conversationWorkflowContinuationStore', () => ({
  openConversationWorkflowContinuationStore: async () => ({}),
}));
const original = {
  status: 'ready',
  selection: { providerId: 'account-a', modelId: 'model-a' },
  provider: { id: 'provider-a' },
  modelId: 'model-a',
  recipient: 'recipient-a',
  remoteProcessing: true,
} as Extract<SelectedAiResolution, { status: 'ready' }>;
const observer = {
  openWorkflowContinuation: async () => ({}) as never,
  retentionRequestId: 'synthetic',
  retentionSession: { id: 'session', version: 1 },
  onWorkflowPauseController: () => {},
  onWorkflowPaused: async () => true,
} as RagConversationObserver;

test.each([
  { modelId: 'other' },
  { recipient: 'other' },
  { provider: { id: 'other' } },
  { remoteProcessing: false },
  { selection: { providerId: 'account-b', modelId: 'model-a' } },
])('rejects changed live selection before continuation: %j', async change => {
  const selectedAi = jest.fn(
    async () => ({ ...original, ...change }) as typeof original,
  );
  const continuation = await prepareConversationContinuation(
    observer,
    original,
    selectedAi,
  );
  await expect(
    continuation!.validateSelection!(new AbortController().signal),
  ).rejects.toThrow('selection changed');
});

test('unchanged live selection passes but a cancelled owner never resolves a provider', async () => {
  const selectedAi = jest.fn(async () => original);
  const continuation = await prepareConversationContinuation(
    observer,
    original,
    selectedAi,
  );
  await expect(
    continuation!.validateSelection!(new AbortController().signal),
  ).resolves.toBeUndefined();
  selectedAi.mockClear();
  const stopped = new AbortController();
  stopped.abort();
  await expect(
    continuation!.validateSelection!(stopped.signal),
  ).rejects.toThrow();
  expect(selectedAi).not.toHaveBeenCalled();
});
