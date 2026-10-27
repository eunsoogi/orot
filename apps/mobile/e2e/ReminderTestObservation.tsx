import { enableReminderFailureOrigins } from '../src/appointmentReminders/reminderFailureOrigin';
import { ReminderOriginControl } from './ReminderOriginControl';
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
export function ReminderTestObservation({
  children,
  originControl = false,
}: PropsWithChildren<{ readonly originControl?: boolean }>) {
  const [action, setAction] = useState<ReminderActionReceipt | null>(null);
  const [diagnostic, setDiagnostic] = useState<Record<string, unknown>>({
    status: 'pending',
  });
  const [receipt, setReceipt] = useState<Record<string, unknown>>({
    status: 'pending',
  });
  useEffect(() => {
    let active = true;
    let reading = false;
    let stopActions = () => {};
    let stopOrigins = () => {};
    let mode: 'unknown' | 'disabled' | 'ready' | 'failed' = 'unknown';
    let checkingHealth = false;
    const health = async () => {
      if (!active || checkingHealth || mode === 'disabled' || mode === 'failed')
        return;
      checkingHealth = true;
      try {
        const ready =
          await NativeModules.OrotReminderTestObservation.diagnosticReadiness();
        if (!active) return;
        setDiagnostic(ready);
        if (ready.status === 'disabled') mode = 'disabled';
        else if (ready.status === 'ready') {
          if (mode === 'unknown') {
            stopOrigins = enableReminderFailureOrigins(ready.runID ?? '');
            stopActions = observeReminderActions(setAction);
          }
          mode = 'ready';
        } else mode = 'failed';
      } catch {
        mode = 'failed';
        if (active) setDiagnostic({ status: 'readiness-unavailable' });
      } finally {
        checkingHealth = false;
      }
    };
    const read = async () => {
      if (
        !active ||
        reading ||
        !['ready', 'disabled'].includes(mode) ||
        AppState.currentState !== 'active'
      )
        return;
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
    health()
      .then(read)
      .catch(() => undefined);
    // This is an observation cadence, never a delivery deadline or a retry of app startup.
    const interval = setInterval(() => {
      // Health stays independent of a pending OS snapshot and adds no notification-center query.
      health().catch(() => undefined);
      read().catch(() => undefined);
    }, 250);
    return () => {
      active = false;
      clearInterval(interval);
      stopActions();
      stopOrigins();
    };
  }, []);
  return (
    <>
      {originControl ? (
        diagnostic.status === 'ready' && diagnostic.originControl === true ? (
          <ReminderOriginControl action={action} />
        ) : null
      ) : (
        children
      )}
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
