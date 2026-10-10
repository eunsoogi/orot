import 'react-native-get-random-values';
import { NativeModules } from 'react-native';
import { selectEntryRoute } from './selectEntryRoute';

const settingsManager = (
  NativeModules as unknown as {
    SettingsManager?: {
      settings?: Record<string, unknown>;
      getConstants?: () => { settings?: Record<string, unknown> };
    };
  }
).SettingsManager;
const launchSettings =
  settingsManager?.settings ?? settingsManager?.getConstants?.().settings ?? {};

switch (selectEntryRoute(launchSettings)) {
  case 'agent-memory':
    require('./agentMemoryProbeEntry');
    break;
  case 'appointments':
    require('./appointmentsProbeEntry');
    break;
  case 'medical-appointment-classification':
    // Keep the issue-40 consent exercise on synthetic Calendar and provider data.
    require('./medicalAppointmentClassificationProbeEntry');
    break;
  case 'medical-appointment-app-navigation':
    // Exercise #108 through App with deterministic local fixtures and no provider inference.
    require('./medicalAppointmentNavigationProbeEntry');
    break;
  case 'graph':
    require('./graphProbeEntry');
    break;
  case 'checkpoint':
    require('./checkpointProbeEntry');
    break;
  case 'safe-area':
    // Keep keyboard and large-text checks synthetic and free of provider permissions.
    require('./safeAreaProbeEntry');
    break;
  case 'safe-area-blood-pressure':
    // Exercise the production route with deterministic rows and no HealthKit access.
    require('./safeAreaBloodPressureProbeEntry');
    break;
  case 'storage':
    require('./storageProbeEntry');
    break;
  case 'ai-feature-visit-questions':
    // Keep the production App navigation and inject synthetic operations only for the UI proof.
    require('./aiFeatureVisitQuestionsProbeEntry');
    break;
}
