import 'react-native-get-random-values';
import { NativeModules } from 'react-native';
import { selectEntryRoute } from './selectEntryRoute';
import { retainedVisitObservationEnabled } from './retainedVisitObservation';

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
    // Keep calendar classification consent checks on synthetic Calendar and provider data.
    require('./medicalAppointmentClassificationProbeEntry');
    break;
  case 'medical-appointment-app-navigation':
    // Exercise #108 through App with deterministic local fixtures and no provider inference.
    require('./medicalAppointmentNavigationProbeEntry');
    break;
  case 'medical-document-import':
    // Run the production Records route so the UI test must choose through UIKit's document picker.
    require('./medicalDocumentImportProbeEntry');
    break;
  case 'medical-document-picker-recovery':
    // This separate probe isolates storage while retaining the native system picker.
    require('./medicalDocumentPickerRecoveryProbeEntry');
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
    // The diagnostic opt-in mounts the retained editor under the existing UIKit observation gate.
    if (retainedVisitObservationEnabled(launchSettings))
      require('./nextVisitQuestionsProbeEntry');
    else require('./aiFeatureVisitQuestionsProbeEntry');
    break;
}
