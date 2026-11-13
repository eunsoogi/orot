import { createDailyReminderDrain } from '../dailyReminderDrain';

test('suppressed passive restoration does not prevent an explicit notification delivery', async () => {
  const restore = jest.fn(async () => 'opened');
  const deliver = jest.fn(async () => {});
  const drain = createDailyReminderDrain({
    cleanup: async () => false,
    shouldRestore: async () => false,
    restore,
    deliver,
    onBusy: jest.fn(),
    onClosed: jest.fn(),
  });
  await drain();
  expect(restore).not.toHaveBeenCalled();
  expect(deliver).toHaveBeenCalledTimes(1);
});
