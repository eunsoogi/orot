import { createDailyReportIdentity } from '@orot/domain';
import { createDailyReminderDestination } from '../../../appointmentReminders/dailyReminderDestination';
import { parseDailyReminderEntry } from '../../../appointmentReminders/dailyReminderDelivery';
import { createDailyReportConversationIntentStore } from '../dailyReportConversationIntentStore';

test('a dismissal queued during selection wins without restoring the entry', async () => {
  const old = createDailyReportIdentity('2023-11-15', 'Asia/Seoul');
  const intent = {
    kind: 'daily-report' as const,
    entryKey: 'daily-conversation:test-race',
    request: {
      localDate: old.localDate,
      timeZone: old.timeZone,
      requestedAt: '2023-11-15T03:00:00Z',
    },
  };
  let saved = { intent, active: true };
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  let started!: () => void;
  const writing = new Promise<void>(resolve => {
    started = resolve;
  });
  const store = createDailyReportConversationIntentStore({
    read: async () => saved,
    write: async value => {
      if (value.active) {
        started();
        await gate;
      }
      saved = value;
    },
  });
  const selecting = store.select(intent.entryKey, {
    ...intent.request,
    localDate: '2023-11-16',
  });
  await writing;
  const dismissing = store.dismiss(intent.entryKey);
  release();
  await Promise.all([selecting, dismissing]);
  expect((await store.read())?.active).toBe(false);
});

test('reminder dismissal queued during selection preserves the closed state', async () => {
  const entry = parseDailyReminderEntry(
    { kind: 'daily_report', deliveryTimestamp: '1700000000' },
    'Asia/Seoul',
  )!;
  let saved = { entry, active: true };
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  let started!: () => void;
  const writing = new Promise<void>(resolve => {
    started = resolve;
  });
  const destination = createDailyReminderDestination({
    read: async () => saved,
    write: async value => {
      if (value.active) {
        started();
        await gate;
      }
      saved = value;
    },
    open: async () => 'opened' as const,
  });
  const selecting = destination.select(entry.entryKey, {
    localDate: '2023-11-16',
    timeZone: 'Asia/Seoul',
    requestedAt: '2023-11-16T03:00:00Z',
  });
  await writing;
  const dismissing = destination.dismiss(entry.entryKey);
  release();
  await Promise.all([selecting, dismissing]);
  expect(saved.active).toBe(false);
});
