import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import { name as appName } from '../app.json';
import App from '../App';
import { designHealthObservations } from './designHealthFixtures';

const records = designHealthObservations().sort((a, b) =>
  b.effectiveAt.localeCompare(a.effectiveAt),
);
const loadHealthObservationPage = async () => ({ records, nextCursor: null });

function DesignHealthProbe() {
  return <App loadHealthObservationPage={loadHealthObservationPage} />;
}

/** Renders production navigation and health screens with explicitly synthetic local observations. */
AppRegistry.registerComponent(appName, () => DesignHealthProbe);
