import '../src/agent/polyfills';
import { AppRegistry } from 'react-native';
import { name as appName } from '../app.json';
import { HealthKitProbe } from './healthkitProbe';

AppRegistry.registerComponent(appName, () => HealthKitProbe);
