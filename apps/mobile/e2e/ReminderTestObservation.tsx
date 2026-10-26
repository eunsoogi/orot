import { useEffect, useState, type PropsWithChildren } from 'react';
import {
  AppState,
  NativeModules,
  PixelRatio,
  StyleSheet,
  Text,
  View,
} from 'react-native';

/** Observes the real OS request center without replacing any production app behavior. */
export function ReminderTestObservation({ children }: PropsWithChildren) {
  const [receipt, setReceipt] = useState<Record<string, unknown>>({
    status: 'pending',
  });
  useEffect(() => {
    let active = true;
    let reading = false;
    const read = async () => {
      if (!active || reading || AppState.currentState !== 'active') return;
      reading = true;
      try {
        const observed =
          await NativeModules.OrotReminderTestObservation.snapshot();
        if (active)
          setReceipt({ ...observed, fontScale: PixelRatio.getFontScale() });
      } catch {
        if (active)
          setReceipt({ status: 'failed', code: 'os-observation-unavailable' });
      } finally {
        reading = false;
      }
    };
    read().catch(() => undefined);
    // This is an observation cadence, never a delivery deadline or a retry of app startup.
    const interval = setInterval(() => read().catch(() => undefined), 250);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);
  return (
    <>
      {children}
      <View pointerEvents="none" style={styles.marker}>
        <Text
          testID="reminder-os-observation"
          accessibilityLabel={JSON.stringify(receipt)}
          style={styles.text}
        >
          Reminder OS observation
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  marker: { position: 'absolute', bottom: 0, right: 0, width: 1, height: 1 },
  text: { fontSize: 1, lineHeight: 1 },
});
