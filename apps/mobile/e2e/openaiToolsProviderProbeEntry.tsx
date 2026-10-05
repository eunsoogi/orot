import '../src/agent/polyfills';
import { AppRegistry } from 'react-native';
import { name as appName } from '../app.json';
import { OpenAIToolsProviderProbe } from './openaiToolsProviderProbe';

AppRegistry.registerComponent(appName, () => OpenAIToolsProviderProbe);
