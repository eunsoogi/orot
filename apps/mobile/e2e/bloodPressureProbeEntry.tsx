import '../src/agent/polyfills';
import { AppRegistry } from 'react-native';
import { name as appName } from '../app.json';
import { BloodPressureProbe } from './bloodPressureProbe';

// The dedicated entry keeps this probe out of the normal application bundle.
AppRegistry.registerComponent(appName, () => BloodPressureProbe);
