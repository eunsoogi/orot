import { useEffect, useState, type PropsWithChildren } from 'react';
import {
  observeReminderActions,
  type ReminderActionReceipt,
} from '../src/appointmentReminders/reminderActionObservation';
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
  const [action, setAction] = useState<ReminderActionReceipt | null>(null);
  const [diagnostic, setDiagnostic] = useState<Record<string, unknown> | null>(
    null,
  );
  const [receipt, setReceipt] = useState<Record<string, unknown>>({
    status: 'pending',
  });
  useEffect(() => {
    let active = true;
    let reading = false;
    let stopActions = () => {};
    let diagnosticReady = false;
    const read = async () => {
      if (!active || reading || AppState.currentState !== 'active') return;
      reading = true;
      // The independent writer handshake completes before any diagnostic OS query.
      if (!diagnosticReady) {
        try {
          const ready =
            await NativeModules.OrotReminderTestObservation.diagnosticReadiness();
          if (!active) return;
          setDiagnostic(ready);
          if (ready.status !== 'disabled' && ready.status !== 'ready') return;
          diagnosticReady = true;
          if (ready.status === 'ready')
            stopActions = observeReminderActions(setAction);
        } catch {
          if (active) setDiagnostic({ status: 'readiness-unavailable' });
          return;
        }
      }
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
      stopActions();
    };
  }, []);
  return (
    <>
      {children}
      <View pointerEvents="none" style={styles.marker}>
        <Text
          testID="reminder-diagnostic-readiness"
          accessibilityLabel={JSON.stringify(diagnostic)}
          style={styles.text}
        >
          Reminder diagnostic readiness
        </Text>
        <Text
          testID="reminder-action-observation"
          accessibilityLabel={JSON.stringify(action)}
          style={styles.text}
        >
          Reminder action observation
        </Text>
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
