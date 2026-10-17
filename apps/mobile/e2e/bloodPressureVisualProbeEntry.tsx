import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import { name as appName } from '../app.json';
import App from '../App';

/** Uses the real Settings health category controls without requesting HealthKit access. */
AppRegistry.registerComponent(appName, () => App);
