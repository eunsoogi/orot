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
import { registerNavigationTestObserver } from '../src/navigation/navigationTestObservation';
import { AppearanceTestObservation } from './AppearanceTestObservation';
import { compactNavigationObservation } from './compactNavigationObservation';
import { ReminderTestObservation } from './ReminderTestObservation';

const settingsManager = NativeModules.SettingsManager as
  | {
      settings?: Record<string, unknown>;
      getConstants?: () => { settings?: Record<string, unknown> };
    }
  | undefined;
const settings =
  settingsManager?.settings ?? settingsManager?.getConstants?.().settings ?? {};
const route = selectTestRoute(settings);
const lifecycleObservation =
  settings.OROT_TEST_NAVIGATION_OBSERVATION === 'YES' ||
  settings.OROT_TEST_EXPORT_OBSERVATION === 'YES';
const appearanceObservation =
  settings.OROT_TEST_APPEARANCE_OBSERVATION === 'YES';
const reminderObservation = settings.OROT_TEST_REMINDER_OBSERVATION === 'YES';
const geometryObservation =
  settings.OROT_TEST_UI_GEOMETRY === 'YES' || lifecycleObservation;
if (lifecycleObservation) {
  registerNavigationTestObserver(value =>
    NativeModules.OrotTestControl.recordObservation(value),
  );
}

// XCUITest frames omit UIView.safeAreaInsets. This opt-in listener retains the native event and its measured frame without estimating an inset.
if (geometryObservation || appearanceObservation || reminderObservation) {
  AppRegistry.setWrapperComponentProvider(() => TestObservationWrapper);
}

// This entry is bundled only for integration test products. An app-hosted XCTest must
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

// Test wrappers observe layout and reapply XCTest appearance through a test-only native window refresh, retaining the production screen tree.
function TestObservationWrapper({ children }: PropsWithChildren) {
  const content = geometryObservation ? (
    <GeometryTestWrapper>{children}</GeometryTestWrapper>
  ) : (
    children
  );
  const observed = appearanceObservation ? (
    <AppearanceTestObservation>{content}</AppearanceTestObservation>
  ) : (
    content
  );
  return reminderObservation ? (
    <ReminderTestObservation>{observed}</ReminderTestObservation>
  ) : (
    observed
  );
}

function GeometryTestWrapper({ children }: PropsWithChildren) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const navigationMarker = useRef<ComponentRef<typeof Text>>(null);
  const gestureMarker = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    if (!lifecycleObservation) return;
    let active = true;
    // Update only the diagnostic native label; avoid a React render loop during UIKit transitions.
    const timer = setInterval(() => {
      NativeModules.OrotTestControl.navigationSnapshot().then(
        (value: unknown) => {
          if (active) {
            navigationMarker.current?.setNativeProps({
              accessibilityLabel: JSON.stringify(value),
            });
            gestureMarker.current?.setNativeProps({
              accessibilityLabel: compactNavigationObservation(value),
            });
          }
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
      {lifecycleObservation ? (
        <View pointerEvents="none" style={styles.geometryMarker}>
          <Text
            ref={navigationMarker}
            accessible
            accessibilityLabel="{}"
            style={styles.geometryMarkerText}
            testID="navigation-test-observation"
          >
            {t('probe.layout.layoutObservation')}
          </Text>
          <Text
            ref={gestureMarker}
            accessible
            accessibilityLabel="{}"
            style={styles.geometryMarkerText}
            testID="navigation-gesture-observation"
          >
            {t('probe.layout.layoutObservation')}
          </Text>
        </View>
      ) : null}
      {metrics ? (
        <View pointerEvents="none" style={styles.geometryMarker}>
          <Text
            accessible
            accessibilityLabel={JSON.stringify(metrics)}
            style={styles.geometryMarkerText}
            testID="safe-area-test-observation"
          >
            {t('probe.layout.layoutObservation')}
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
