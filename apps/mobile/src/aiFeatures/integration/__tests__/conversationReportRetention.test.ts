import { createDailyReportIdentity } from '@orot/domain';
import { createConversationRetentionBridge } from '../conversationRetentionBridge';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';

test('retains only the selected report target with a committed answer', async () => {
  const dailyReport = {
    identity: createDailyReportIdentity('2026-11-10', 'Asia/Seoul'),
    runId: 'run',
    revision: 1,
  };
  const save = jest.fn(async () => {});
  const bridge = createConversationRetentionBridge({
    observer: { onRetentionCandidate: save },
    registry: new LocalEvidenceReferenceRegistry(),
    question: 'question',
    providerId: 'provider',
    modelId: 'model',
    entryContext: { intent: 'conversation', entryKey: 'route', dailyReport },
    signal: new AbortController().signal,
  });
  bridge.onValidatedEvidence([]);
  await bridge.finish({ status: 'answer', answer: 'answer', citations: [] });
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ dailyReport }),
    expect.any(AbortSignal),
  );
  expect(JSON.stringify(save.mock.calls)).not.toContain('entryKey');
});
