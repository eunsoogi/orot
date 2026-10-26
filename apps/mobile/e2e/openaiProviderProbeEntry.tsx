import '../src/agent/polyfills';
import { AppRegistry } from 'react-native';
import { name as appName } from '../app.json';
import { OpenAIProviderProbe } from './openaiProviderProbe';

AppRegistry.registerComponent(appName, () => OpenAIProviderProbe);
