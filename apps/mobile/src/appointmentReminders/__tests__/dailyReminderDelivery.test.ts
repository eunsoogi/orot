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

test('a declined leave prompt cancels that tap while the next tap remains actionable', async () => {
  const pending = [
    { kind: 'daily_report', deliveryTimestamp: '1700000000' },
    { kind: 'daily_report', deliveryTimestamp: '1700000100' },
  ];
  const consume = jest.fn(async () => pending[0] ?? null);
  const acknowledge = jest.fn(async () => {
    pending.shift();
  });
  const confirm = jest
    .fn()
    .mockResolvedValueOnce('declined')
    .mockResolvedValue('approved');
  const unavailable = jest.fn();
  const consumer = jest.fn(() => true);
  const unregister = registerDailyReminderConsumer(consumer);
  await createDailyReminderDelivery({
    consume,
    acknowledge,
    confirm,
    unavailable,
  })();
  expect(consumer).toHaveBeenCalledTimes(1);
  expect(consumer).toHaveBeenCalledWith(
    expect.objectContaining({ deliveredAt: '2023-11-14T22:15:00.000Z' }),
  );
  expect(acknowledge).toHaveBeenCalledTimes(2);
  unregister();
});

test('does not deliver to a replacement destination after a pending leave prompt', async () => {
  const pending = [{ kind: 'daily_report', deliveryTimestamp: '1700000000' }];
  let approve!: (result: 'approved') => void;
  const confirm = jest.fn(
    () =>
      new Promise<'approved'>(resolve => {
        approve = resolve;
      }),
  );
  const unavailable = jest.fn();
  const original = jest.fn(() => true);
  const replacement = jest.fn(() => true);
  const unregisterOriginal = registerDailyReminderConsumer(original);
  const deliver = createDailyReminderDelivery({
    consume: async () => pending[0] ?? null,
    acknowledge: async () => {
      pending.shift();
    },
    confirm,
    unavailable,
  });
  const delivery = deliver();
  await Promise.resolve();
  await Promise.resolve();
  const unregisterReplacement = registerDailyReminderConsumer(replacement);
  approve('approved');
  await delivery;
  expect(original).not.toHaveBeenCalled();
  expect(replacement).not.toHaveBeenCalled();
  expect(unavailable).toHaveBeenCalledTimes(1);
  unregisterOriginal();
  unregisterReplacement();
});

test('surfaces an unavailable date when the destination cannot resolve it', async () => {
  const pending = [{ kind: 'daily_report', deliveryTimestamp: '1700000000' }];
  const unavailable = jest.fn();
  const unregister = registerDailyReminderConsumer(() => false);
  await createDailyReminderDelivery({
    consume: async () => pending[0] ?? null,
    acknowledge: async () => {
      pending.shift();
    },
    confirm: async () => 'approved',
    unavailable,
  })();
  expect(unavailable).toHaveBeenCalledTimes(1);
  unregister();
});
