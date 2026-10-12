import '../src/agent/polyfills';
import { AppRegistry, NativeModules, StyleSheet, View } from 'react-native';
import { useEffect, useState, type ComponentType } from 'react';
import { name as appName } from '../app.json';
import { selectTestRoute } from './testRoute';
import { startTestOperationRunner } from './testOperationRunner';
import { registerCapabilityTestEntry } from './capabilityTestEntry';
import { registerTestApplicationRenderer } from './testApplicationRenderer';

const settingsManager = NativeModules.SettingsManager as
  | {
      settings?: Record<string, unknown>;
      getConstants?: () => { settings?: Record<string, unknown> };
    }
  | undefined;
const settings =
  settingsManager?.settings ?? settingsManager?.getConstants?.().settings ?? {};
const route = selectTestRoute(settings);

// This entry is bundled only for native test products. An app-hosted XCTest must
// call the production services without starting an unrelated JS Speech probe.
if (route === 'test-host') {
  AppRegistry.registerComponent(appName, () => IntegrationTestHost);
} else if (route === 'speech') {
  require('./transcriptionProbeEntry');
} else if (route === 'openai-provider') {
  require('./openaiProviderProbeEntry');
} else if (route === 'next-visit-questions') {
  require('./nextVisitQuestionsProbeEntry');
} else if (!registerCapabilityTestEntry(route)) {
  require('./e2eRouterEntry');
}

function IntegrationTestHost() {
  const [applicationVisible, setApplicationVisible] = useState(false);
  useEffect(
    () => registerTestApplicationRenderer(() => setApplicationVisible(true)),
    [],
  );
  useEffect(startTestOperationRunner, []);
  // Loading App only on request keeps domain service cases independent of route startup and provider effects.
  if (applicationVisible) {
    const Application = require('../App').default as ComponentType;
    return <Application />;
  }
  return (
    <View
      accessible
      accessibilityLabel="Integration test host"
      style={styles.host}
      testID="integration-test-host"
    />
  );
}

const styles = StyleSheet.create({ host: { flex: 1 } });
