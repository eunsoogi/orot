import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import App from '../App';
import { name as appName } from '../app.json';
import type { CalendarBridge, CalendarEvent } from '../src/calendar/types';
import { createAppleSelectionOption } from '../src/providers/selection/options';
import type { AiFeatureServiceDependencies } from '../src/aiFeatures/integration/featureServices';
import type { ProviderSelectionStore } from '../src/providers/selection/types';
import type { SelectedAiResolverOptions } from '../src/aiFeatures/integration/provider';

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
const appointmentRepository: AppointmentRepository = {
  list: async () => [],
  create: async () => {
    throw new Error('This navigation probe does not save appointments.');
  },
  confirmCalendarEvent: async () => {
    throw new Error('This navigation probe does not save appointments.');
  },
  reconfirmCalendarEvent: async () => {
    throw new Error('This navigation probe does not save appointments.');
  },
  update: async () => {
    throw new Error('This navigation probe does not save appointments.');
  },
  cancel: async () => {
    throw new Error('This navigation probe does not save appointments.');
  },
};
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
