import { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { Appointment } from '@orot/storage';
import type { AiFeatureServices } from '../aiFeatures/integration/featureServices';
import type { SavedVisitQuestionsLoadState } from '../aiFeatures/integration/savedVisitQuestions';
import { AppText } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { appColors } from '../layout/appColors';
import { NavigationRouteScrollView } from '../navigation/NavigationRouteScrollView';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { formatDateTime } from '../i18n';
import { appointmentStartTime } from '../calendar/appointmentTime';
import { useAppointmentReminderRuntime } from './AppointmentReminderContext';
import { resolveAppointmentReminderTarget } from './reminderPlan';
import { selectNextAppointment } from '../routes/nextAppointment';

/** A tap opens preparation for this visit, even when another visit is sooner.
 * Only reviewed local questions are read; opening a notification never starts inference.
 */
export function AppointmentPreparationRoute({
  routeKey,
  loadSavedQuestions,
}: {
  readonly routeKey: string;
  readonly loadSavedQuestions?: AiFeatureServices['loadSavedVisitQuestions'];
}) {
  const runtime = useAppointmentReminderRuntime();
  const focused = useIsFocused();
  const [state, setState] = useState<{
    appointment: Appointment;
    saved: SavedVisitQuestionsLoadState;
  } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(
    () => () => {
      runtime?.homePreparationTargets.delete(routeKey);
    },
    [runtime, routeKey],
  );
  useEffect(() => {
    if (!focused) return;
    let active = true;
    setState(null);
    setError(false);
    const load = async () => {
      if (!runtime || !loadSavedQuestions)
        throw new Error('Preparation unavailable.');
      const target = runtime.targets.get(routeKey);
      const resolve = async () => {
        const appointments = await runtime.list();
        const homeId = runtime.homePreparationTargets.get(routeKey);
        // Home accepts the displayed active visit until its known end. Notification taps retain their strict future/time-key validation.
        if (homeId)
          return selectNextAppointment(
            appointments.filter(appointment => appointment.id === homeId),
            Date.now(),
          );
        return resolveAppointmentReminderTarget(
          target,
          appointments,
          Date.now(),
        );
      };
      const appointment = await resolve();
      if (!appointment) throw new Error('Stale appointment.');
      const saved = await loadSavedQuestions(appointment.id);
      // Reading questions can overlap cancellation; never show a stale visit or another visit's list.
      const current = await resolve();
      if (!current || saved.appointmentId !== appointment.id)
        throw new Error('Stale preparation.');
      if (active) setState({ appointment: current, saved });
    };
    load().catch(() => {
      if (active) setError(true);
    });
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') retry();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [runtime, routeKey, loadSavedQuestions, focused, attempt, retry]);
  return (
    <NavigationRouteScrollView>
      <View style={styles.container} testID="appointment-preparation">
        <AppText accessibilityRole="header" style={styles.title}>
          진료 준비
        </AppText>
        {error ? (
          <>
            <AppText accessibilityRole="alert">
              예약을 확인하지 못했거나 예약이 바뀌었어요. 일정에서 최신 내용을
              확인해 주세요.
            </AppText>
            <AppButton title="다시 확인" onPress={retry} />
          </>
        ) : state ? (
          <>
            <AppText>
              {state.appointment.clinicLabel ??
                state.appointment.reason ??
                '예약'}
            </AppText>
            <AppText>
              {formatDateTime(
                new Date(appointmentStartTime(state.appointment)),
              )}
            </AppText>
            {state.appointment.note ? (
              <AppText>{state.appointment.note}</AppText>
            ) : null}
            <AppText accessibilityRole="header">이 예약에 저장한 질문</AppText>
            {state.saved.status === 'error' ? (
              <AppText accessibilityRole="alert">{state.saved.message}</AppText>
            ) : (
              <>
                {state.saved.questions.length === 0 ? (
                  <AppText>
                    저장한 질문이 없어요. 진료 전에 확인할 질문과 필요한 기록을
                    정리해 주세요.
                  </AppText>
                ) : (
                  state.saved.questions.map((question, index) => (
                    <View key={index}>
                      <AppText>{question.questionText}</AppText>
                      <AppText>{question.rationale}</AppText>
                    </View>
                  ))
                )}
                {state.saved.restorationNotice ? (
                  <AppText>{state.saved.restorationNotice}</AppText>
                ) : null}
              </>
            )}
            <AppText>
              최근 증상 변화, 복용 정보와 확인할 기록을 준비해 주세요.
            </AppText>
          </>
        ) : (
          <AppText>예약을 확인하고 있어요.</AppText>
        )}
      </View>
    </NavigationRouteScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16, backgroundColor: appColors.background },
  title: { fontSize: 30, fontWeight: '700' },
});
