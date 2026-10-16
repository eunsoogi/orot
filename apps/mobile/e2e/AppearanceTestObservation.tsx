import { useEffect, useState, type PropsWithChildren } from 'react';
import {
  AppState,
  NativeEventEmitter,
  NativeModules,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';

/** Exposes the application's real React Native appearance subscription only when the test entry opts in. */
export function AppearanceTestObservation({ children }: PropsWithChildren) {
  const appearance = useColorScheme();
  const [refresh, setRefresh] = useState<Record<string, unknown>>({
    status: 'pending',
    count: 0,
  });
  useEffect(() => {
    let mounted = true;
    let count = 0;
    const observe = (value: Record<string, unknown>) => {
      if (mounted)
        setRefresh({ ...value, status: 'refreshed', count: ++count });
    };
    // Native events acknowledge a window refresh even when its scheme was already selected. The separate hook remains the screen's real subscription.
    const changes = new NativeEventEmitter(
      NativeModules.OrotTestControl,
    ).addListener('appearanceRefreshed', value =>
      observe(value as Record<string, unknown>),
    );
    const readSystemAppearance = () => {
      Promise.resolve()
        .then(() => NativeModules.OrotTestControl.refreshAppearance())
        .then(observe, (error: unknown) => {
          if (mounted)
            setRefresh({ status: 'failed', count, error: String(error) });
        });
    };
    if (AppState.currentState === 'active') readSystemAppearance();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') readSystemAppearance();
    });
    return () => {
      mounted = false;
      subscription.remove();
      changes.remove();
    };
  }, []);
  return (
    <>
      {children}
      <View pointerEvents="none" style={styles.marker}>
        <Text
          accessible
          accessibilityLabel={appearance ?? 'unspecified'}
          style={styles.text}
          testID="application-appearance-observation"
        >
          Appearance observation
        </Text>
        <Text
          accessible
          // Both sources belong to this render; a native payload cannot replace the independent hook.
          accessibilityLabel={JSON.stringify({
            ...refresh,
            applicationScheme: appearance ?? 'unspecified',
          })}
          style={styles.text}
          testID="application-appearance-refresh"
        >
          Appearance refresh
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  marker: { position: 'absolute', left: 0, top: 0 },
  text: { fontSize: 1 },
});
