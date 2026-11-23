import { StyleSheet, View } from 'react-native';
import type { Appointment } from '@orot/storage';
import type {
  RestoredSavedVisitQuestions,
  RestoredVisitQuestion,
} from '../aiFeatures/integration/savedVisitQuestionTypes';
import { formatDateTime, t } from '../i18n';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { appointmentTimeLabel } from './nextAppointment';

/** This read-only grouping does not reinterpret a saved date as the appointment's current date. */
export function VisitDayQuestionsContent({
  appointment,
  saved,
}: {
  readonly appointment: Appointment;
  readonly saved: RestoredSavedVisitQuestions;
}) {
  const current: RestoredVisitQuestion[] = [];
  const historical = new Map<number | null, RestoredVisitQuestion[]>();
  const date = Date.parse(appointment.effectiveAt);
  for (const question of saved.questions) {
    const savedDate = saved.savedAppointmentDates?.get(question.identity.id);
    const timestamp = Date.parse(savedDate ?? '');
    if (timestamp === date) current.push(question);
    else {
      const key = Number.isFinite(timestamp) ? timestamp : null;
      const group = historical.get(key) ?? [];
      group.push(question);
      historical.set(key, group);
    }
  }
  return (
    <>
      <View
        style={[styles.surface, styles.withIcon]}
        testID="visit-day-appointment"
      >
        <View style={styles.icon}>
          <AppSymbol name="calendar" color={appColors.primaryText} />
        </View>
        <View style={styles.copy}>
          <AppText style={styles.label}>
            {t('visitDayQuestions.selectedAppointment')}
          </AppText>
          {appointment.clinicLabel ? (
            <AppText style={styles.sectionTitle}>
              {appointment.clinicLabel}
            </AppText>
          ) : null}
          <AppText style={styles.date}>
            {appointmentTimeLabel(appointment)}
          </AppText>
        </View>
      </View>
      <View style={styles.group} testID="visit-day-current-questions">
        <AppText accessibilityRole="header" style={styles.sectionTitle}>
          {t('visitDayQuestions.currentQuestions')}
        </AppText>
        {current.length ? (
          <QuestionCards questions={current} />
        ) : (
          <AppText style={styles.supporting}>
            {t('visitDayQuestions.empty')}
          </AppText>
        )}
      </View>
      {[...historical]
        .sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity))
        .map(([time, questions]) => (
          <View
            key={time ?? 'unknown'}
            style={styles.group}
            testID="visit-day-historical-questions"
          >
            <AppText accessibilityRole="header" style={styles.sectionTitle}>
              {t(
                time === null
                  ? 'visitDayQuestions.unknownDate'
                  : 'visitDayQuestions.originalDate',
              )}
            </AppText>
            {time !== null ? (
              <AppText style={styles.supporting}>
                {formatDateTime(new Date(time))}
              </AppText>
            ) : null}
            <QuestionCards questions={questions} />
          </View>
        ))}
      {saved.restorationNotice ? (
        <View
          style={[styles.surface, styles.withIcon]}
          testID="visit-day-provenance"
        >
          <AppSymbol
            name={
              saved.restorationWarning
                ? 'exclamationmark.circle'
                : 'info.circle'
            }
            color={appColors.secondary}
          />
          <View style={styles.copy}>
            <AppText style={styles.sectionTitle}>
              {t('visitDayQuestions.provenance')}
            </AppText>
            <AppText accessibilityRole="alert" style={styles.supporting}>
              {saved.restorationNotice}
            </AppText>
          </View>
        </View>
      ) : null}
    </>
  );
}

function QuestionCards({
  questions,
}: {
  readonly questions: readonly RestoredVisitQuestion[];
}) {
  return questions.map((question, index) => (
    <View key={question.identity.id} style={[styles.surface, styles.withIcon]}>
      <AppText accessibilityElementsHidden style={styles.number}>
        {index + 1}
      </AppText>
      <View style={styles.copy}>
        <AppText
          style={styles.question}
          testID={`visit-day-question-${question.identity.id}`}
        >
          {question.questionText}
        </AppText>
        <AppText style={styles.supporting}>{question.rationale}</AppText>
      </View>
    </View>
  ));
}

const styles = StyleSheet.create({
  group: { gap: 10 },
  surface: {
    backgroundColor: appColors.surface,
    borderRadius: 18,
    padding: 16,
  },
  withIcon: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: appColors.primarySoft,
  },
  copy: { flex: 1, minWidth: 0, gap: 6 },
  label: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
  date: { fontSize: 17, fontWeight: '600', lineHeight: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '700', lineHeight: 22 },
  question: { fontSize: 16, fontWeight: '600', lineHeight: 24 },
  number: { color: appColors.primaryText, fontWeight: '700' },
  supporting: { color: appColors.secondary, fontSize: 14, lineHeight: 21 },
});
