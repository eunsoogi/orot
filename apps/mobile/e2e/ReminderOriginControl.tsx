import { useEffect, useMemo, useState } from 'react';
import { NativeModules, Text, View } from 'react-native';
import type { Appointment } from '@orot/storage';
import { AppointmentReminderCoordinator } from '../src/appointmentReminders/reminderCoordinator';
import { createAppointmentReminderPort } from '../src/appointmentReminders/reminderPort';
import type { AppointmentReminderSelection } from '../src/appointmentReminders/reminderPlan';
import { AppointmentReminderControls } from '../src/appointmentReminders/AppointmentReminderControls';
import { AppointmentReminderProvider } from '../src/appointmentReminders/AppointmentReminderContext';
import type { AppointmentReminderRuntime } from '../src/appointmentReminders/AppointmentReminderContext';
import type { ReminderActionReceipt } from '../src/appointmentReminders/reminderActionObservation';

const appointment: Appointment = {
  id: 'synthetic-origin-control',
  status: 'scheduled',
  effectiveAt: '2099-06-01T12:00:00.000Z',
  recordedAt: '2099-01-01T00:00:00.000Z',
  ingestedAt: '2099-01-01T00:00:00.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
};

/** A synthetic fixture, not OS scheduling acceptance: real Controls → coordinator → port → RN reject. */
export function ReminderOriginControl({
  action,
}: {
  readonly action: ReminderActionReceipt | null;
}) {
  const [done, setDone] = useState(false);
  const [expected, setExpected] = useState<unknown>(null);
  const [normalized, setNormalized] = useState(false);
  const runtime = useMemo(() => {
    let selection: AppointmentReminderSelection | null = null;
    const transport: boolean[] = [];
    const port = createAppointmentReminderPort(() => ({
      readSelection: async () => selection,
      writeSelection: async value => {
        selection = value;
      },
      authorizationStatus: async () => 'authorized',
      requestAuthorization: async () => 'authorized',
      consumeTarget: async () => null,
      replace: value =>
        NativeModules.AppointmentReminderModule.replace(value).catch(
          (error: {
            code?: unknown;
            message?: unknown;
            userInfo?: unknown;
          }) => {
            const info = error.userInfo;
            transport.push(
              error.code === 'REMINDER_SCHEDULE_FAILED' &&
                error.message === 'The local reminder could not be updated.' &&
                typeof info === 'object' &&
                info !== null &&
                Object.keys(info).length === 1 &&
                Object.keys(info)[0] === 'orotReminderOrigin',
            );
            throw error;
          },
        ),
    }));
    const coordinator = new AppointmentReminderCoordinator(
      async () => [appointment],
      port,
      () => 0,
    );
    return {
      coordinator,
      transport,
      list: async () => [appointment],
      load: async () => {
        throw new Error('Synthetic control has no repository');
      },
      targets: new Map(),
    } satisfies AppointmentReminderRuntime & { transport: boolean[] };
  }, []);
  useEffect(() => {
    let queued = false;
    let active = true;
    const coordinator = runtime.coordinator;
    const stop = coordinator.subscribe(() => {
      if (queued || !coordinator.getSnapshot().busy) return;
      queued = true;
      // Queue C while selected A is pending. B is A's failed cleanup, never A's origin.
      coordinator
        .reconcile()
        .catch(() => undefined)
        .then(async () => {
          const value =
            await NativeModules.OrotReminderTestObservation.originControlExpected();
          if (active) {
            setExpected(value);
            setNormalized(
              runtime.transport.length === 4 &&
                runtime.transport.every(Boolean),
            );
            setDone(true);
          }
        })
        .catch(() => {
          if (active) setDone(true);
        });
    });
    return () => {
      active = false;
      stop();
    };
  }, [runtime]);
  return (
    <View style={{ padding: 24, paddingTop: 100 }}>
      <AppointmentReminderProvider runtime={runtime}>
        <AppointmentReminderControls appointment={appointment} />
      </AppointmentReminderProvider>
      <Text
        testID="reminder-origin-control"
        accessibilityLabel={JSON.stringify({
          done,
          expected,
          action,
          normalized,
        })}
      >
        Synthetic actual RN origin control
      </Text>
    </View>
  );
}
