import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import { name as appName } from '../app.json';
import App from '../App';
import type { BloodPressureSyncResult } from '../src/healthkit/bloodPressure/types';

const illustrativeResult: BloodPressureSyncResult = {
  status: 'completed',
  readAuthorization: 'notObservable',
  upserted: 3,
  deleted: 1,
  cursorAdvanced: true,
};

/** Renders the Release result layout with display-only counts; it never calls HealthKit or saves fixture records. */
function BloodPressureVisualProbe() {
  return (
    <App
      importBloodPressure={async () => illustrativeResult}
      loadHealthObservations={async () => []}
    />
  );
}

AppRegistry.registerComponent(appName, () => BloodPressureVisualProbe);
