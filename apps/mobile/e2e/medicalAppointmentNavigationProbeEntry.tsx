// LangGraph reads ReadableStream during module initialization on Hermes.
import '../src/agent/polyfills';
import 'react-native-get-random-values';
import { AppRegistry, NativeModules } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import type { Appointment } from '@orot/domain';
import {
  cancelAppointment,
  createAppointment,
  updateAppointment,
} from '@orot/domain';
import App from '../App';
import { name as appName } from '../app.json';
import type { CalendarBridge, CalendarEvent } from '../src/calendar/types';
import { createAppleSelectionOption } from '../src/providers/selection/options';
import type { AiFeatureServiceDependencies } from '../src/aiFeatures/integration/featureServices';
import type { ProviderSelectionStore } from '../src/providers/selection/types';
import type { SelectedAiResolverOptions } from '../src/aiFeatures/integration/provider';
import { homeAppointmentTimingFixture } from './homeAppointmentTimingFixture';

const settingsManager = NativeModules?.SettingsManager;
const launchSettings =
  settingsManager?.settings ?? settingsManager?.getConstants?.().settings ?? {};
// Capture the fixture origin once, so Home refreshes do not postpone its end boundary.
const homeAppointments = homeAppointmentTimingFixture(
  launchSettings.OROT_HOME_APPOINTMENT_TIMING,
  Date.now(),
);

const appointmentRepository = createNavigationProbeRepository(homeAppointments);

type ManualAppointmentInput = Parameters<AppointmentRepository['create']>[0];

const selectedOption = createAppleSelectionOption('available');
const selectionStore: ProviderSelectionStore = {
  load: async () => ({
    providerId: selectedOption.provider.id,
    modelId: selectedOption.modelId,
  }),
  save: async () => undefined,
  clear: async () => undefined,
};
const selectedAi: SelectedAiResolverOptions = {
  selectionStore,
  loadAppleOption: async () => selectedOption,
};
const aiFeatureServiceDependencies: AiFeatureServiceDependencies = {
  selectedAi,
};
/** Uses isolated session memory so manual-entry tests never open persisted user storage. */
function createNavigationProbeRepository(
  initialAppointments: readonly Appointment[],
): AppointmentRepository {
  const appointments = new Map(
    initialAppointments.map(appointment => [appointment.id, appointment]),
  );
  let sequence = 0;
  const requireAppointment = (id: string) => {
    const appointment = appointments.get(id);
    if (!appointment) throw new Error('Synthetic appointment not found.');
    return appointment;
  };
  const saveNewManualAppointment = (input: ManualAppointmentInput) => {
    const now = new Date().toISOString();
    const appointment = createAppointment({
      ...input,
      id: `synthetic-manual-appointment-${++sequence}`,
      recordedAt: now,
      ingestedAt: now,
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
    });
    appointments.set(appointment.id, appointment);
    return appointment;
  };

  return {
    list: async () => [...appointments.values()],
    create: async input => saveNewManualAppointment(input),
    // Classification remains failure-only in this navigation fixture.
    confirmCalendarEvent: async () => {
      throw new Error('This navigation probe does not save calendar events.');
    },
    reconfirmCalendarEvent: async () => {
      throw new Error(
        'This navigation probe does not reconfirm calendar events.',
      );
    },
    update: async (id, changes) => {
      const updated = updateAppointment(
        requireAppointment(id),
        changes,
        new Date().toISOString(),
      );
      appointments.set(id, updated);
      return updated;
    },
    cancel: async id => {
      const cancelled = cancelAppointment(
        requireAppointment(id),
        new Date().toISOString(),
      );
      appointments.set(id, cancelled);
      return cancelled;
    },
  };
}
const event: CalendarEvent = {
  calendarEventIdentifier: 'synthetic-medical-appointment-navigation',
  effectiveAt: '2035-06-02T00:00:00.000Z',
  endsAt: '2035-06-02T01:00:00.000Z',
  calendarEventSnapshot: {
    title: '합성 진료 예약',
    timeZoneIdentifier: 'Asia/Seoul',
    isAllDay: false,
    occurrenceDate: null,
    isDetached: false,
    recurrenceRules: [],
  },
};
const calendarBridge: CalendarBridge = {
  requestAccessAndListUpcomingEvents: async () => ({
    access: 'fullAccess',
    events: [event],
  }),
  findEvent: async () => ({ access: 'fullAccess', event }),
  addEventStoreListener: () => ({ remove: () => undefined }),
};

/** Keeps App navigation deterministic; the test does not request Calendar access or run inference. */
function MedicalAppointmentNavigationProbeEntry() {
  return (
    <App
      aiFeatureServiceDependencies={aiFeatureServiceDependencies}
      calendarBridge={calendarBridge}
      loadAppointments={async () => appointmentRepository}
    />
  );
}

AppRegistry.registerComponent(
  appName,
  () => MedicalAppointmentNavigationProbeEntry,
);
