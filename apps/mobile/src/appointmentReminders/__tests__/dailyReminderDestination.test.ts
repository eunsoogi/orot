import {
  createDailyReminderDestination,
  type SavedDailyReminderEntry,
} from '../dailyReminderDestination';
import {
  createDailyReminderDelivery,
  parseDailyReminderEntry,
  registerDailyReminderConsumer,
} from '../dailyReminderDelivery';

const entry = parseDailyReminderEntry(
  { kind: 'daily_report', deliveryTimestamp: '1700000000' },
  'Asia/Seoul',
)!;

test('persists before opening and restores the original observed date after restart', async () => {
  let saved: SavedDailyReminderEntry | null = null;
  let release!: () => void;
  const write = jest.fn(async (value: SavedDailyReminderEntry) => {
    await new Promise<void>(resolve => {
      release = resolve;
    });
    saved = value;
  });
  const open = jest.fn(() => 'opened' as const);
  const port = { read: async () => saved, write, open };
  const destination = createDailyReminderDestination(port);
  const accepting = destination.accept(entry);
  await Promise.resolve();
  await Promise.resolve();
  expect(open).not.toHaveBeenCalled();
  release();
  expect(await accepting).toBe('opened');
  expect(open).toHaveBeenCalledWith(entry);
  const restored = createDailyReminderDestination(port);
  await restored.restore();
  expect(open).toHaveBeenCalledTimes(2);
  expect(open).toHaveBeenLastCalledWith(
    expect.objectContaining({
      dateInObservedTimeZone: '2023-11-15',
      observedTimeZone: 'Asia/Seoul',
    }),
  );
});

test('serializes duplicates and retains a dismissed identity across restart', async () => {
  let saved: SavedDailyReminderEntry | null = null;
  const write = jest.fn(async (value: SavedDailyReminderEntry) => {
    saved = value;
  });
  let visible = false;
  const open = jest.fn(() => {
    if (!visible) visible = true;
    return 'opened' as const;
  });
  const port = { read: async () => saved, write, open };
  const destination = createDailyReminderDestination(port);
  await Promise.all([destination.accept(entry), destination.accept(entry)]);
  expect(write).toHaveBeenCalledTimes(1);
  expect(visible).toBe(true);
  await destination.dismiss(entry.entryKey);
  visible = false;
  await createDailyReminderDestination(port).accept(entry);
  expect(visible).toBe(false);
  expect(saved).toMatchObject({ active: false });
});

test('keeps a second notification unacknowledged while the first route is active', async () => {
  const later = parseDailyReminderEntry(
    { kind: 'daily_report', deliveryTimestamp: '1700000100' },
    'Asia/Seoul',
  )!;
  let saved: SavedDailyReminderEntry | null = null;
  let activeKey: string | null = null;
  const destination = createDailyReminderDestination({
    read: async () => saved,
    write: async value => {
      saved = value;
    },
    canOpen: value => !activeKey || activeKey === value.entryKey,
    open: value => {
      activeKey = value.entryKey;
      return 'opened';
    },
  });
  expect(await destination.accept(entry)).toBe('opened');
  expect(await destination.accept(later)).toBe('busy');
  expect(saved).toMatchObject({
    entry: { entryKey: entry.entryKey },
    active: true,
  });
  await destination.dismiss(entry.entryKey);
  activeKey = null;
  expect(await destination.accept(later)).toBe('opened');
  expect(saved).toMatchObject({
    entry: { entryKey: later.entryKey },
    active: true,
  });
});

test('preserves a declined restore without opening or treating it as busy', async () => {
  const open = jest.fn(() => 'declined' as const);
  const write = jest.fn();
  const destination = createDailyReminderDestination({
    read: async () => ({ entry, active: true }),
    write,
    open,
  });
  expect(await destination.restore()).toBe('declined');
  expect(write).toHaveBeenCalledWith({ entry, active: false });
});

test('a declined restored tap is acknowledged without prompting again for the same native entry', async () => {
  let saved: SavedDailyReminderEntry | null = { entry, active: true };
  const open = jest.fn(() => 'declined' as const);
  const destination = createDailyReminderDestination({
    read: async () => saved,
    write: async value => {
      saved = value;
    },
    open,
  });
  expect(await destination.restore()).toBe('declined');
  const confirm = jest.fn(async () => 'approved' as const);
  const pending = [{ kind: 'daily_report', deliveryTimestamp: '1700000000' }];
  const acknowledge = jest.fn(async () => {
    pending.shift();
  });
  const unregister = registerDailyReminderConsumer(destination.accept);
  await createDailyReminderDelivery({
    consume: async () => pending[0] ?? null,
    acknowledge,
    confirm,
    alreadyHandled: destination.alreadyHandled,
    onBusy: jest.fn(),
    unavailable: jest.fn(),
  })();
  expect(confirm).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledTimes(1);
  expect(acknowledge).toHaveBeenCalledTimes(1);
  unregister();
});
