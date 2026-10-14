import { useState } from 'react';
import {
  AppRegistry,
  Pressable,
  requireNativeComponent,
  ScrollView,
  StyleSheet,
  Text,
  type ViewProps,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  Screen,
  ScreenStack,
  ScreenStackHeaderConfig,
} from 'react-native-screens';
import { name as appName } from '../app.json';

const UIKitBoundary = requireNativeComponent<ViewProps>(
  'OrotNavigationBoundaryView',
);

/** Local boundary fixtures omit business services, route guards and app reconciliation. */
export function registerNavigationBoundaryFixture(boundary: 'uikit' | 'rns') {
  AppRegistry.registerComponent(appName, () =>
    boundary === 'uikit' ? UIKitFixture : RNSFixture,
  );
}

function UIKitFixture() {
  return <UIKitBoundary style={styles.full} />;
}

function RNSFixture() {
  return (
    <SafeAreaProvider>
      <RNSStack />
    </SafeAreaProvider>
  );
}

function RNSStack() {
  const [childVisible, setChildVisible] = useState(false);
  return (
    <ScreenStack style={styles.full}>
      <Screen activityState={childVisible ? 1 : 2} style={styles.full}>
        <ScreenStackHeaderConfig hidden />
        <Surface child={false} openChild={() => setChildVisible(true)} />
      </Screen>
      {childVisible ? (
        <Screen activityState={2} style={styles.full}>
          <ScreenStackHeaderConfig hidden />
          <Surface child />
        </Screen>
      ) : null}
    </ScreenStack>
  );
}

function Surface({
  child,
  openChild,
}: {
  child: boolean;
  openChild?: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Match the window-top-inset-to-bottom swipe viewport; no app keyboard or toolbar logic participates.
  return (
    <ScrollView
      testID={child ? 'boundary-child-surface' : 'boundary-root-surface'}
      contentInsetAdjustmentBehavior="never"
      style={[styles.surface, { top: insets.top }]}
      contentContainerStyle={styles.content}
    >
      <Text testID={child ? 'boundary-child-title' : 'boundary-root-title'}>
        {child ? 'RNS child' : 'RNS root'}
      </Text>
      {!child ? (
        <Pressable
          testID="boundary-open-child"
          onPress={openChild}
          style={styles.button}
        >
          <Text>Open child</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: 'white' },
  surface: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  content: { minHeight: 1100, paddingTop: 60, paddingHorizontal: 24 },
  button: { marginTop: 60, minHeight: 48 },
});
