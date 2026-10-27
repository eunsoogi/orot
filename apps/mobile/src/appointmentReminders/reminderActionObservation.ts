import {
  reminderFailureOrigin,
  type ReminderFailureOrigin,
} from './reminderFailureOrigin';
import type {
  AppointmentReminderCoordinator,
  AppointmentReminderState,
} from './reminderCoordinator';

export interface ReminderActionReceipt {
  readonly sequence: number;
  readonly origin?: ReminderFailureOrigin | 'unknown';
  readonly outcome: 'begin' | 'resolve' | 'reject';
  readonly status: AppointmentReminderState['status'];
  readonly busy: boolean;
  readonly currentStatus: AppointmentReminderState['status'];
  readonly currentBusy: boolean;
}

let observer: ((receipt: ReminderActionReceipt) => void) | undefined;
let sequence = 0;
let stopCurrent = () => {};

/** Only the opted-in test entry installs a listener; no visit or error values cross this boundary. */
export function observeReminderActions(
  listener: (receipt: ReminderActionReceipt) => void,
) {
  observer = listener;
  return () => {
    if (observer === listener) {
      observer = undefined;
      stopCurrent();
    }
  };
}

/** Observe the existing promise without adding a selection, query, or coordinator operation. */
export function beginReminderAction(
  state: AppointmentReminderState,
  current?: Pick<AppointmentReminderCoordinator, 'getSnapshot' | 'subscribe'>,
) {
  const listener = observer;
  if (!listener) return () => undefined;
  stopCurrent();
  const action = ++sequence;
  let receipt: ReminderActionReceipt;
  const emit = (
    outcome: ReminderActionReceipt['outcome'],
    value: AppointmentReminderState,
    error?: unknown,
  ) => {
    const live = current?.getSnapshot() ?? value;
    receipt = {
      sequence: action,
      ...(outcome === 'reject'
        ? { origin: reminderFailureOrigin(error) ?? 'unknown' }
        : {}),
      outcome,
      status: value.status,
      busy: value.busy,
      currentStatus: live.status,
      currentBusy: live.busy,
    };
    publish();
  };
  const publish = () => {
    // Observation cannot change the user action's result if a test listener fails.
    try {
      listener(receipt);
    } catch {
      /* test observation only */
    }
  };
  emit('begin', state);
  stopCurrent =
    current?.subscribe(() => {
      const live = current.getSnapshot();
      receipt = {
        ...receipt,
        currentStatus: live.status,
        currentBusy: live.busy,
      };
      publish();
    }) ?? (() => {});
  return (
    outcome: 'resolve' | 'reject',
    value: AppointmentReminderState,
    error?: unknown,
  ) => emit(outcome, value, error);
}
