import { createAppointmentReminderRuntime } from '../../../appointmentReminders/AppointmentReminderContext';
import { requestDailyReportFromConversation } from '../dailyReportConversationEntry';
import type { createDailyReportFeature } from '../dailyReportFeature';

test('an explicit conversation action starts one shared report request and retains its typed date', async () => {
  const runtime = createAppointmentReminderRuntime(async () => {
    throw new Error('unused');
  });
  const operation = {
    status: 'started' as const,
    result: Promise.resolve({ status: 'failed' as const, code: 'cancelled' }),
    cancel: jest.fn(),
  };
  const start = jest.fn(() => operation);
  const feature = { start } as unknown as ReturnType<
    typeof createDailyReportFeature
  >;
  const navigate = jest.fn(() => ({ key: 'route-2' }));
  const input = {
    feature,
    runtime,
    navigate,
    now: '2026-11-10T03:00:00Z',
    timeZone: 'Asia/Seoul',
    isCurrent: () => true,
    store: {
      activate: jest.fn(async () => {}),
      dismiss: jest.fn(async () => {}),
    },
  };
  await Promise.all([
    requestDailyReportFromConversation(input),
    requestDailyReportFromConversation(input),
  ]);
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({
      localDate: '2026-11-10',
      timeZone: 'Asia/Seoul',
    }),
    { kind: 'reuse_or_generate' },
  );
  expect(runtime.dailyConversationTargets.get('route-2')).toMatchObject({
    intent: { kind: 'daily-report', request: { localDate: '2026-11-10' } },
    operation,
  });
});

test('navigation refusal never starts generation', async () => {
  const runtime = createAppointmentReminderRuntime(async () => {
    throw new Error('unused');
  });
  const start = jest.fn();
  await requestDailyReportFromConversation({
    feature: { start } as unknown as ReturnType<
      typeof createDailyReportFeature
    >,
    runtime,
    navigate: () => null,
    now: '2026-11-10T03:00:00Z',
    timeZone: 'Asia/Seoul',
    isCurrent: () => true,
    store: {
      activate: jest.fn(async () => {}),
      dismiss: jest.fn(async () => {}),
    },
  });
  expect(start).not.toHaveBeenCalled();
});

test('a durable write failure never opens the route or starts inference', async () => {
  const runtime = createAppointmentReminderRuntime(async () => {
    throw new Error('unused');
  });
  const start = jest.fn();
  const navigate = jest.fn();
  const result = await requestDailyReportFromConversation({
    feature: { start } as unknown as ReturnType<
      typeof createDailyReportFeature
    >,
    runtime,
    navigate,
    now: '2026-11-10T03:00:00Z',
    timeZone: 'Asia/Seoul',
    isCurrent: () => true,
    store: {
      activate: jest.fn(async () => {
        throw new Error('unavailable');
      }),
      dismiss: jest.fn(async () => {}),
    },
  });
  expect(result).toBe('unavailable');
  expect(navigate).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
});

test('leaving the originating conversation while storage waits prevents navigation and generation', async () => {
  const runtime = createAppointmentReminderRuntime(async () => {
    throw new Error('unused');
  });
  let release!: () => void;
  let current = true;
  const activate = jest.fn(
    () =>
      new Promise<void>(resolve => {
        release = resolve;
      }),
  );
  const dismiss = jest.fn(async () => {});
  const navigate = jest.fn(() => ({ key: 'route-2' }));
  const start = jest.fn();
  const request = requestDailyReportFromConversation({
    feature: { start } as unknown as ReturnType<
      typeof createDailyReportFeature
    >,
    runtime,
    navigate,
    now: '2026-11-10T03:00:00Z',
    timeZone: 'Asia/Seoul',
    isCurrent: () => current,
    store: { activate, dismiss },
  });
  current = false;
  release();
  expect(await request).toBe('abandoned');
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
});
