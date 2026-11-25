/**
 * @format
 */

import './src/agent/polyfills';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { markProcessDiagnosticBridge } from './src/providers/processDiagnosticWitness';

AppRegistry.registerComponent(appName, () => {
  markProcessDiagnosticBridge();
  return App;
});
