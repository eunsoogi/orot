import { createAppointmentReminderRuntime } from '../../../appointmentReminders/AppointmentReminderContext';
import { requestDailyReportFromConversation } from '../dailyReportConversationEntry';
import type { createDailyReportFeature } from '../dailyReportFeature';

test('an explicit conversation action starts one shared report request and retains its typed date', () => {
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
  };
  requestDailyReportFromConversation(input);
  requestDailyReportFromConversation(input);
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

test('navigation refusal never starts generation', () => {
  const runtime = createAppointmentReminderRuntime(async () => {
    throw new Error('unused');
  });
  const start = jest.fn();
  requestDailyReportFromConversation({
    feature: { start } as unknown as ReturnType<
      typeof createDailyReportFeature
    >,
    runtime,
    navigate: () => null,
    now: '2026-11-10T03:00:00Z',
    timeZone: 'Asia/Seoul',
  });
  expect(start).not.toHaveBeenCalled();
});
