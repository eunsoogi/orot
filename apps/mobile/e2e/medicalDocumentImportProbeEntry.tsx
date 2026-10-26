import '../src/agent/polyfills';
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from '../App';
import { name as appName } from '../app.json';

/** Keeps the real Records route and repository active for the system-picker import journey. */
function MedicalDocumentImportProbeEntry() {
  return <App />;
}

AppRegistry.registerComponent(appName, () => MedicalDocumentImportProbeEntry);
