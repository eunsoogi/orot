import { createDailyReportIdentity } from '@orot/domain';
import { createDailyReportRequests } from '../dailyReportRequests';
import type { RagConversationObserver } from '../../../ragConversation/conversationObserver';

/** Synthetic shared work: completion stays pending while the actual provider signals processing. */
test('a conversation joining an active daily report receives its processing receipt before completion', async () => {
  const today = createDailyReportIdentity('2026-11-18', 'Asia/Seoul');
  let providerObserver: RagConversationObserver | undefined;
  let finish!: () => void;
  const requests = createDailyReportRequests({
    lookup: jest.fn(),
    currentIdentity: () => today,
    run: async (_identity, _mode, _signal, observer) => {
      providerObserver = observer;
      await new Promise<void>(resolve => {
        finish = resolve;
      });
      return { status: 'failed', code: 'cancelled' };
    },
  });
  const original = { onProviderReceipt: jest.fn() };
  const joined = { onProviderReceipt: jest.fn() };
  const first = requests.start(today, { kind: 'reuse_or_generate' }, original);
  await Promise.resolve();
  const second = requests.start(today, { kind: 'reuse_or_generate' }, joined);
  try {
    expect(first.status).toBe('started');
    expect(second.status).toBe('started');
    expect(joined.onProviderReceipt).not.toHaveBeenCalled();
    providerObserver?.onProviderReceipt?.('response_started');
    expect(original.onProviderReceipt).toHaveBeenCalledWith('response_started');
    expect(joined.onProviderReceipt).toHaveBeenCalledWith('response_started');
  } finally {
    finish();
    if (first.status === 'started') await first.result;
  }
});
