import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { Appointment } from '@orot/storage';
import type { AiFeatureServices } from '../aiFeatures/integration/featureServiceTypes';
import type { SavedVisitQuestionsLoadState } from '../aiFeatures/integration/savedVisitQuestions';
import { useAppointmentReminderRuntime } from '../appointmentReminders/AppointmentReminderContext';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import { NavigationRouteScrollView } from '../navigation/NavigationRouteScrollView';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { AppText } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { t } from '../i18n';
import { VisitDayQuestionsContent } from './VisitDayQuestionsContent';
import { appColors } from '../layout/appColors';

/** Read only the route-bound appointment; never send saved questions to a model. */
export function VisitDayQuestionsRoute({
  routeKey,
  loadSavedQuestions,
}: {
  readonly routeKey: string;
  readonly loadSavedQuestions?: AiFeatureServices['loadSavedVisitQuestions'];
}) {
  const runtime = useAppointmentReminderRuntime();
  const focused = useIsFocused();
  const [attempt, setAttempt] = useState(0);
  const [foreground, setForeground] = useState(
    AppState.currentState === 'active',
  );
  const [state, setState] = useState<{
    routeKey: string;
    appointment: Appointment;
    saved: SavedVisitQuestionsLoadState;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });
  useEffect(() => {
    let current = true;
    setState(null);
    setFailed(false);
    if (!focused || !foreground) return;
    const invalidate = () => {
      current = false;
      setState(null);
      setAttempt(value => value + 1);
    };
    const clear = subscribeLocalDataClear(invalidate);
    const deleted = subscribeLocalSourceDeletion(invalidate);
    const read = async () => {
      const id = runtime?.overviewPreparationTargets.get(routeKey);
      if (!id || !runtime || !loadSavedQuestions)
        throw new Error('Missing visit target.');
      const resolve = async () =>
        (await runtime.list()).find(
          row =>
            row.id === id &&
            (row.status === 'scheduled' || row.status === 'rescheduled'),
        );
      const appointment = await resolve();
      if (!appointment) throw new Error('Visit unavailable.');
      const saved = await loadSavedQuestions(id);
      const latest = await resolve();
      if (
        !latest ||
        JSON.stringify(latest) !== JSON.stringify(appointment) ||
        saved.appointmentId !== id
      )
        throw new Error('Visit changed.');
      if (current) setState({ routeKey, appointment, saved });
    };
    read().catch(() => {
      if (current) setFailed(true);
    });
    return () => {
      current = false;
      clear();
      deleted();
    };
  }, [routeKey, runtime, focused, foreground, loadSavedQuestions, attempt]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', value => {
      setState(null);
      setForeground(value === 'active');
      if (value === 'active') setAttempt(old => old + 1);
    });
    return () => subscription.remove();
  }, []);
  const visible =
    focused && foreground && state?.routeKey === routeKey ? state : null;
  return (
    <NavigationRouteScrollView>
      <View testID="visit-day-questions" style={styles.container}>
        <View style={styles.header}>
          <AppText accessibilityRole="header" style={styles.title}>
            {t('visitDayQuestions.title')}
          </AppText>
          <AppText style={styles.subtitle}>
            {t('visitDayQuestions.readOnly')}
          </AppText>
        </View>
        {failed || visible?.saved.status === 'error' ? (
          <>
            <AppText accessibilityRole="alert">
              {visible?.saved.status === 'error'
                ? visible.saved.message
                : t('appointments.preparation.changed')}
            </AppText>
            <AppButton
              title={t('appointments.preparation.retry')}
              onPress={() => setAttempt(value => value + 1)}
              testID="visit-day-questions-retry"
            />
          </>
        ) : visible?.saved.status === 'ready' ? (
          <VisitDayQuestionsContent
            appointment={visible.appointment}
            saved={visible.saved}
          />
        ) : (
          <AppText>{t('appointments.preparation.loading')}</AppText>
        )}
      </View>
    </NavigationRouteScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  header: { gap: 8 },
  title: { fontSize: 26, fontWeight: '700', lineHeight: 34 },
  subtitle: { color: appColors.secondary, fontSize: 15, lineHeight: 22 },
});
