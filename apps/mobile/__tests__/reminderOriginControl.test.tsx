import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import { useEffect, useState } from 'react';
import { ReminderOriginControl } from '../e2e/ReminderOriginControl';
import {
  observeReminderActions,
  type ReminderActionReceipt,
} from '../src/appointmentReminders/reminderActionObservation';
import { enableReminderFailureOrigins } from '../src/appointmentReminders/reminderFailureOrigin';

const runID = 'c5555555-1111-2222-3333-444444444444';
const roles = ['selected', 'cleanup', 'reconcile', 'reconcile-cleanup'];
const expected = Object.fromEntries(
  roles.map((role, i) => [role, { runID, operationSequence: i + 11 }]),
);

function ObservedControl() {
  const [action, setAction] = useState<ReminderActionReceipt | null>(null);
  useEffect(() => observeReminderActions(setAction), []);
  return <ReminderOriginControl action={action} />;
}

/** This JS control verifies plumbing only; the canonical XCUITest separately requires actual RN serialization. */
it.each(['selected', 'missing', 'cleanup', 'reconcile'])(
  'the real Controls receipt retains actual rejection origin %s through later failures',
  async originRole => {
    const stop = enableReminderFailureOrigins(runID);
    const calls: string[] = [];
    const previousModule = NativeModules.AppointmentReminderModule;
    NativeModules.AppointmentReminderModule = {
      replace: jest.fn(async () => {
        const role = roles[calls.length];
        calls.push(role);
        const origin =
          role === 'selected' ? expected[originRole] : expected[role];
        throw Object.assign(
          new Error('The local reminder could not be updated.'),
          {
            code: 'REMINDER_SCHEDULE_FAILED',
            userInfo: origin ? { orotReminderOrigin: origin } : null,
          },
        );
      }),
    };
    NativeModules.OrotReminderTestObservation = {
      originControlExpected: jest.fn(async () => expected),
    };
    try {
      await render(<ObservedControl />);
      await fireEvent.press(
        screen.getByTestId('appointment-reminder-synthetic-origin-control-60'),
      );
      await act(async () => {});
      const value = JSON.parse(
        screen.getByTestId('reminder-origin-control').props.accessibilityLabel,
      );
      expect(calls).toEqual(roles);
      expect(value.done).toBe(true);
      expect(value.normalized).toBe(originRole !== 'missing');
      expect(value.action).toEqual(
        expect.objectContaining({
          outcome: 'reject',
          status: 'error',
          busy: false,
          currentBusy: false,
        }),
      );
      // A missing/wrong native token must never be silently replaced by the later native calls.
      expect(value.action.origin).toEqual(expected[originRole] ?? 'unknown');
      if (originRole !== 'selected')
        expect(value.action.origin).not.toEqual(expected.selected);
    } finally {
      stop();
      NativeModules.AppointmentReminderModule = previousModule;
      delete NativeModules.OrotReminderTestObservation;
    }
  },
);
