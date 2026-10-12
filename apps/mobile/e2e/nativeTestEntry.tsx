import '../src/agent/polyfills';
import { AppRegistry, NativeModules, StyleSheet, View } from 'react-native';
import { name as appName } from '../app.json';
import { selectNativeTestRoute } from './nativeTestRoute';

const settingsManager = NativeModules.SettingsManager as
  | {
      settings?: Record<string, unknown>;
      getConstants?: () => { settings?: Record<string, unknown> };
    }
  | undefined;
const settings =
  settingsManager?.settings ?? settingsManager?.getConstants?.().settings ?? {};
const route = selectNativeTestRoute(settings);

// This entry is bundled only for native test products. An app-hosted XCTest must
// call the production services without starting an unrelated JS Speech probe.
if (route === 'test-host') {
  AppRegistry.registerComponent(appName, () => NativeIntegrationHost);
} else if (route === 'speech') {
  require('./transcriptionProbeEntry');
} else if (route === 'openai-provider') {
  require('./openaiProviderProbeEntry');
} else if (route === 'next-visit-questions') {
  require('./nextVisitQuestionsProbeEntry');
} else {
  require('./e2eRouterEntry');
}

function NativeIntegrationHost() {
  return (
    <View
      accessible
      accessibilityLabel="Native integration test host"
      style={styles.host}
      testID="native-integration-host"
    />
  );
}

const styles = StyleSheet.create({ host: { flex: 1 } });
