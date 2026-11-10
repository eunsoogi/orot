import '../src/agent/polyfills';
import { AppRegistry, NativeModules } from 'react-native';
import { name as appName } from '../app.json';
import { NextVisitQuestionsProbe } from './nextVisitQuestionsProbe';
import { VisitQuestionPersistenceProbe } from './visitQuestionPersistenceProbe';

const settings =
  NativeModules.SettingsManager?.settings ??
  NativeModules.SettingsManager?.getConstants?.().settings ??
  {};
// This isolated fixture uses the real encrypted database only when explicitly selected.
AppRegistry.registerComponent(appName, () =>
  settings.OROT_VISIT_QUESTION_PERSISTENCE === 'synthetic'
    ? VisitQuestionPersistenceProbe
    : NextVisitQuestionsProbe,
);
