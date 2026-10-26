import '../src/agent/polyfills';
import { AppRegistry } from 'react-native';
import { name as appName } from '../app.json';
import { NextVisitQuestionsProbe } from './nextVisitQuestionsProbe';

AppRegistry.registerComponent(appName, () => NextVisitQuestionsProbe);
