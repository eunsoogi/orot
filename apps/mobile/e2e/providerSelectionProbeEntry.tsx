import '../src/agent/polyfills';
import { AppRegistry } from 'react-native';
import { name as appName } from '../app.json';
import { ProviderSelectionProbe } from './providerSelectionProbe';

AppRegistry.registerComponent(appName, () => ProviderSelectionProbe);
