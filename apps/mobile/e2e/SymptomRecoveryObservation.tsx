import {
  useEffect,
  useRef,
  type ComponentRef,
  type PropsWithChildren,
} from 'react';
import { NativeModules, StyleSheet, Text, View } from 'react-native';
import { registerNavigationTestObserver } from '../src/navigation/navigationTestObservation';

/** Explicit test-entry wrapper. Bridge events refresh a passive marker without a timer or React state updates. */
export function SymptomRecoveryObservation({ children }: PropsWithChildren) {
  const marker = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    let active = true;
    const unregister = registerNavigationTestObserver(value => {
      NativeModules.OrotTestControl.recordObservation(value);
      // Calls share the existing bridge queue; the snapshot follows this event's record request.
      NativeModules.OrotTestControl.navigationSnapshot()
        .then((snapshot: unknown) => {
          if (active)
            marker.current?.setNativeProps({
              accessibilityLabel: JSON.stringify(snapshot),
            });
        })
        .catch(() => {
          // Missing diagnostics remain unavailable and cannot change the original UI result.
        });
    });
    return () => {
      active = false;
      unregister();
    };
  }, []);
  return (
    <View style={styles.root}>
      {children}
      <View pointerEvents="none" style={styles.marker}>
        <Text
          ref={marker}
          accessible
          accessibilityLabel='{"status":"unavailable"}'
          style={styles.text}
          testID="navigation-test-observation"
        >
          Observation
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  marker: { position: 'absolute', left: 0, top: 0 },
  text: { fontSize: 1 },
});
