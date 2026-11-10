import {
  createDailyReminderDelivery,
  registerDailyReminderConsumer,
} from '../dailyReminderDelivery';

test('defers a tap during navigation and delivers it once with an uncertain delivery timezone', async () => {
  const entry = { kind: 'daily_report', deliveryTimestamp: '1700000000' };
  const pending = [entry, entry];
  const consume = jest.fn(async () => pending[0] ?? null);
  const acknowledge = jest.fn(async () => {
    pending.shift();
  });
  const confirm = jest
    .fn()
    .mockResolvedValueOnce('busy')
    .mockResolvedValue('approved');
  const unavailable = jest.fn();
  const consumer = jest.fn(() => true);
  const unregister = registerDailyReminderConsumer(consumer);
  const deliver = createDailyReminderDelivery({
    consume,
    acknowledge,
    confirm,
    unavailable,
  });
  await deliver();
  expect(consumer).not.toHaveBeenCalled();
  await deliver();
  await deliver();
  expect(consumer).toHaveBeenCalledTimes(1);
  expect(consumer).toHaveBeenCalledWith(
    expect.objectContaining({
      deliveryTimeZone: 'unknown',
      deliveredAt: '2023-11-14T22:13:20.000Z',
    }),
  );
  expect(unavailable).not.toHaveBeenCalled();
  unregister();
});

test('surfaces missing consumers and invalid payloads without navigation', async () => {
  const pending = [
    {
      kind: 'daily_report',
      deliveryTimestamp: '1700000000',
    },
    {
      kind: 'daily_report',
      deliveryTimestamp: 'invalid',
    },
  ];
  const consume = jest.fn(async () => pending[0] ?? null);
  const acknowledge = jest.fn(async () => {
    pending.shift();
  });
  const confirm = jest.fn();
  const unavailable = jest.fn();
  const deliver = createDailyReminderDelivery({
    consume,
    acknowledge,
    confirm,
    unavailable,
  });
  await deliver();
  await deliver();
  expect(unavailable).toHaveBeenCalledTimes(2);
  expect(confirm).not.toHaveBeenCalled();
});
