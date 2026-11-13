import { createNavigationController } from '../../../navigation/navigationController';
import { createAppointmentReminderRuntime } from '../../../appointmentReminders/AppointmentReminderContext';
import { createDailyReportConversationIntentStore } from '../dailyReportConversationIntentStore';
import { restoreDailyReportConversation } from '../restoreDailyReportConversation';
import type { DailyReportConversationIntent } from '../conversationIntent';
import type { AppNavigationRoute } from '../../../routes/appNavigationRoute';

test('restores the exact previous date without running inference and dismisses only that request', async () => {
  let saved: { intent: DailyReportConversationIntent; active: boolean } | null =
    null;
  const store = createDailyReportConversationIntentStore({
    read: async () => saved,
    write: async value => {
      saved = value;
    },
  });
  const intent: DailyReportConversationIntent = {
    kind: 'daily-report',
    entryKey: 'daily-conversation:sample-1',
    request: {
      localDate: '2026-11-09',
      timeZone: 'Asia/Seoul',
      requestedAt: '2026-11-09T03:00:00Z',
    },
  };
  await store.activate(intent);
  const runtime = createAppointmentReminderRuntime(async () => {
    throw new Error('unused');
  });
  const controller = createNavigationController<AppNavigationRoute>('root');
  expect(
    await restoreDailyReportConversation({
      controller,
      runtime,
      store,
      confirm: async () => 'approved',
    }),
  ).toBe('done');
  const route = controller.getSnapshot().currentRoute;
  expect(route.name).toBe('daily-report');
  expect(runtime.dailyConversationTargets.get(route.key)).toEqual({ intent });
  await store.dismiss('different');
  expect((await store.read())?.active).toBe(true);
  await store.dismiss(intent.entryKey);
  expect((await store.read())?.active).toBe(false);
});

test('does not restore over a guarded route or automatically retry a decline', async () => {
  let saved: { intent: DailyReportConversationIntent; active: boolean } | null =
    {
      active: true,
      intent: {
        kind: 'daily-report',
        entryKey: 'daily-conversation:sample-2',
        request: {
          localDate: '2026-11-09',
          timeZone: 'Asia/Seoul',
          requestedAt: '2026-11-09T03:00:00Z',
        },
      },
    };
  const store = createDailyReportConversationIntentStore({
    read: async () => saved,
    write: async value => {
      saved = value;
    },
  });
  const runtime = createAppointmentReminderRuntime(async () => {
    throw new Error('unused');
  });
  const controller = createNavigationController<AppNavigationRoute>('root');
  expect(
    await restoreDailyReportConversation({
      controller,
      runtime,
      store,
      confirm: async () => 'declined',
    }),
  ).toBe('done');
  expect(controller.getSnapshot().currentRoute.name).toBe('root');
  expect((await store.read())?.active).toBe(false);
});

test('an abandoned intent with a failed dismissal stays pending until retry succeeds', async () => {
  const intent: DailyReportConversationIntent = {
    kind: 'daily-report',
    entryKey: 'daily-conversation:test-3',
    request: {
      localDate: '2026-11-09',
      timeZone: 'Asia/Seoul',
      requestedAt: '2026-11-09T03:00:00Z',
    },
  };
  let saved = { intent, active: true };
  const write = jest
    .fn()
    .mockRejectedValueOnce(new Error('locked'))
    .mockImplementation(async value => {
      saved = value;
    });
  const store = createDailyReportConversationIntentStore({
    read: async () => saved,
    write,
  });
  await expect(store.dismiss(intent.entryKey)).rejects.toThrow('locked');
  expect(store.hasPendingDismissal(intent.entryKey)).toBe(true);
  const runtime = createAppointmentReminderRuntime(async () => {
    throw new Error('unused');
  });
  const controller = createNavigationController<AppNavigationRoute>('root');
  expect(
    await restoreDailyReportConversation({
      controller,
      runtime,
      store,
      confirm: async () => 'approved',
    }),
  ).toBe('busy');
  await store.retryDismissals();
  expect(saved.active).toBe(false);
  expect(store.hasPendingDismissal(intent.entryKey)).toBe(false);
});

test('an unavailable navigation guard preserves the saved request for a later foreground', async () => {
  const intent: DailyReportConversationIntent = {
    kind: 'daily-report',
    entryKey: 'daily-conversation:test-4',
    request: {
      localDate: '2026-11-09',
      timeZone: 'Asia/Seoul',
      requestedAt: '2026-11-09T03:00:00Z',
    },
  };
  let saved = { intent, active: true };
  const store = createDailyReportConversationIntentStore({
    read: async () => saved,
    write: async value => {
      saved = value;
    },
  });
  const runtime = createAppointmentReminderRuntime(async () => {
    throw new Error('unused');
  });
  const controller = createNavigationController<AppNavigationRoute>('root');
  expect(
    await restoreDailyReportConversation({
      controller,
      runtime,
      store,
      confirm: async () => 'unavailable',
    }),
  ).toBe('deferred');
  expect(saved.active).toBe(true);
  expect(controller.getSnapshot().currentRoute.name).toBe('root');
});
