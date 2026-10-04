import 'react-native-get-random-values';
import { NativeModules } from 'react-native';
import { selectEntryRoute } from './selectEntryRoute';

const settingsManager = (NativeModules as unknown as {
  SettingsManager?: {
    settings?: Record<string, unknown>;
    getConstants?: () => { settings?: Record<string, unknown> };
  };
}).SettingsManager;
const launchSettings =
  settingsManager?.settings ?? settingsManager?.getConstants?.().settings ?? {};

switch (selectEntryRoute(launchSettings)) {
  case 'agent-memory':
    require('./agentMemoryProbeEntry');
    break;
  case 'graph':
    require('./graphProbeEntry');
    break;
  case 'storage':
    require('./storageProbeEntry');
    break;
}
