import '../src/agent/polyfills';
import {
  AppRegistry,
  NativeModules,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ComponentRef,
  type PropsWithChildren,
} from 'react';
import { SafeAreaListener, type Metrics } from 'react-native-safe-area-context';
import { name as appName } from '../app.json';
import { t } from '../src/i18n';
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

// XCUITest frames omit UIView.safeAreaInsets. This opt-in listener retains the native event and its measured frame without estimating an inset.
if (settings.OROT_TEST_UI_GEOMETRY === 'YES') {
  AppRegistry.setWrapperComponentProvider(() => NativeGeometryTestWrapper);
}

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

function NativeGeometryTestWrapper({ children }: PropsWithChildren) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const navigationMarker = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    if (settings.OROT_TEST_NAVIGATION_OBSERVATION !== 'YES') return;
    let active = true;
    // Update only the diagnostic native label; avoid a React render loop during UIKit transitions.
    const timer = setInterval(() => {
      NativeModules.OrotTestControl.navigationSnapshot().then(
        (value: unknown) => {
          if (active)
            navigationMarker.current?.setNativeProps({
              accessibilityLabel: JSON.stringify(value),
            });
        },
      );
    }, 200);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <SafeAreaListener onChange={setMetrics}>
      {children}
      {settings.OROT_TEST_NAVIGATION_OBSERVATION === 'YES' ? (
        <View pointerEvents="none" style={styles.geometryMarker}>
          <Text
            ref={navigationMarker}
            accessible
            accessibilityLabel="{}"
            style={styles.geometryMarkerText}
            testID="native-navigation-observation"
          >
            {t('probe.layout.nativeObservation')}
          </Text>
        </View>
      ) : null}
      {metrics ? (
        <View pointerEvents="none" style={styles.geometryMarker}>
          <Text
            accessible
            accessibilityLabel={JSON.stringify(metrics)}
            style={styles.geometryMarkerText}
            testID="native-safe-area-observation"
          >
            {t('probe.layout.nativeObservation')}
          </Text>
        </View>
      ) : null}
    </SafeAreaListener>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  geometryMarker: { position: 'absolute', left: 0, top: 0 },
  geometryMarkerText: { fontSize: 1 },
});
