// Keeps this diagnostic entry separate from the App.tsx owner and production UI.
import '../src/agent/polyfills';
import { AppRegistry } from 'react-native';
import { name as appName } from '../app.json';
import { CommonObservationsProbe } from './commonObservationsProbe';

AppRegistry.registerComponent(appName, () => CommonObservationsProbe);
