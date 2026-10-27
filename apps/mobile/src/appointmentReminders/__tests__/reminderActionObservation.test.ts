import { AppointmentReminderCoordinator } from '../reminderCoordinator';
import type { AppointmentReminderPort } from '../reminderCoordinator';
import {
  beginReminderAction,
  observeReminderActions,
} from '../reminderActionObservation';
import type { ReminderActionReceipt } from '../reminderActionObservation';
import type { AppointmentReminderState } from '../reminderCoordinator';

const initial: AppointmentReminderState = {
  selection: null,
  status: 'idle',
  busy: false,
};

it('binds each existing promise result to its own action and excludes visit/error content', () => {
  const events: ReminderActionReceipt[] = [];
  const stop = observeReminderActions(value => events.push(value));
  const first = beginReminderAction(initial);
  const second = beginReminderAction(initial);
  first('reject', { ...initial, status: 'error' });
  second('resolve', { ...initial, status: 'scheduled' });
  expect(events.map(event => event.outcome)).toEqual([
    'begin',
    'begin',
    'reject',
    'resolve',
  ]);
  expect(events[0].sequence).toBe(events[2].sequence);
  expect(events[1].sequence).toBe(events[3].sequence);
  expect(events[1].sequence).toBe(events[0].sequence + 1);
  expect(Object.keys(events[2]).sort()).toEqual([
    'busy',
    'currentBusy',
    'currentStatus',
    'outcome',
    'sequence',
    'status',
  ]);
  stop();
  beginReminderAction(initial)('resolve', initial);
  expect(events).toHaveLength(4);
});

it('does not let observation errors change the action outcome', () => {
  const stop = observeReminderActions(() => {
    throw new Error('Synthetic observer failure');
  });
  expect(() =>
    beginReminderAction(initial)('reject', { ...initial, status: 'error' }),
  ).not.toThrow();
  stop();
});

function boundary() {
  const port: AppointmentReminderPort = {
    readSelection: jest.fn(async () => null),
    writeSelection: jest.fn(async () => undefined),
    authorizationStatus: jest.fn(async () => 'authorized'),
    requestAuthorization: jest.fn(async () => 'authorized'),
    replace: jest.fn(async () => undefined),
  };
  const coordinator = new AppointmentReminderCoordinator(async () => [], port);
  const events: ReminderActionReceipt[] = [];
  let latest: ReminderActionReceipt | undefined;
  const stop = observeReminderActions(value => {
    latest = value;
    if (
      value.outcome !== 'begin' &&
      !events.some(
        event =>
          event.sequence === value.sequence && event.outcome === value.outcome,
      )
    )
      events.push(value);
  });
  const select = () => {
    const settle = beginReminderAction(coordinator.getSnapshot(), coordinator);
    return coordinator.select(null).then(
      () => settle('resolve', coordinator.getSnapshot()),
      () => settle('reject', coordinator.getSnapshot()),
    );
  };
  return { port, coordinator, events, stop, select, latest: () => latest };
}

it('a prior error does not turn the next resolved action into a rejection', async () => {
  const { port, coordinator, events, stop, select } = boundary();
  try {
    jest
      .mocked(port.replace)
      .mockRejectedValueOnce(new Error('Synthetic native error'));
    await select();
    expect(coordinator.getSnapshot().status).toBe('error');
    await select();
    expect(events.map(value => value.outcome)).toEqual(['reject', 'resolve']);
    expect(events[0].status).toBe('error');
    expect(events[1]).toEqual(
      expect.objectContaining({
        outcome: 'resolve',
        status: 'unscheduled',
        busy: false,
      }),
    );
  } finally {
    stop();
  }
});

it('native rejection with unfinished cleanup cannot establish a settled action', async () => {
  const { port, coordinator, events, stop, select } = boundary();
  let release!: () => void;
  let cleanupEntered!: () => void;
  const entered = new Promise<void>(resolve => {
    cleanupEntered = resolve;
  });
  jest
    .mocked(port.replace)
    .mockRejectedValueOnce(new Error('Synthetic native error'))
    .mockImplementationOnce(() => {
      cleanupEntered();
      return new Promise<void>(resolve => {
        release = resolve;
      });
    });
  try {
    const original = select();
    await entered;
    expect(events).toEqual([]);
    expect(coordinator.getSnapshot().busy).toBe(true);
    release();
    await original;
    expect(events[0]).toEqual(
      expect.objectContaining({
        outcome: 'reject',
        status: 'error',
        busy: false,
      }),
    );
  } finally {
    stop();
  }
});

it('a rejected action remains distinct from a queued reconciliation that is now busy', async () => {
  const { port, coordinator, events, stop, select, latest } = boundary();
  let release!: () => void;
  let entered!: () => void;
  const queuedEntered = new Promise<void>(resolve => {
    entered = resolve;
  });
  jest
    .mocked(port.replace)
    .mockRejectedValueOnce(new Error('Synthetic native error'))
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(() => {
      entered();
      return new Promise<void>(resolve => {
        release = resolve;
      });
    });
  try {
    const original = select();
    const queued = coordinator.reconcile();
    await original;
    expect(events[0]).toEqual(
      expect.objectContaining({ outcome: 'reject', busy: false }),
    );
    await queuedEntered;
    // The settlement snapshot remains distinct from the current coordinator state.
    expect(coordinator.getSnapshot().busy).toBe(true);
    expect(latest()).toEqual(
      expect.objectContaining({
        outcome: 'reject',
        busy: false,
        currentBusy: true,
      }),
    );
    release();
    await queued;
    expect(events[0].busy).toBe(false);
  } finally {
    stop();
  }
});
