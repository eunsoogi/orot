import { Pressable, StyleSheet, View } from 'react-native';
import type { Appointment } from '@orot/storage';
import { AppButton } from '../layout/AppButton';
import { AppProgress } from '../layout/AppProgress';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { appointmentTimeLabel } from './nextAppointment';
import type { ReactNode } from 'react';

interface OverviewNextVisitCardProps {
  readonly children?: ReactNode;
  readonly appointment: Appointment | null;
  readonly appointmentState: 'loading' | 'ready' | 'failed';
  readonly onRetryAppointments: () => void;
  readonly onPrepareVisit: () => void;
  readonly onOpenSchedule: () => void;
}

/** One informational visit section, with its existing question and recovery entry points. */
export function OverviewNextVisitCard({
  children,
  appointment,
  appointmentState,
  onRetryAppointments,
  onPrepareVisit,
  onOpenSchedule,
}: OverviewNextVisitCardProps) {
  const nextAppointment =
    appointment && appointment.status !== 'cancelled' ? appointment : null;
  const calendarDay = (date: Date) =>
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const daysUntil = nextAppointment
    ? Math.round(
        (calendarDay(new Date(nextAppointment.effectiveAt)) -
          calendarDay(new Date())) /
          86_400_000,
      )
    : null;

  const countdown =
    daysUntil === null || !Number.isFinite(daysUntil)
      ? null
      : daysUntil === 0
        ? 'D-day'
        : `D${daysUntil > 0 ? '-' : '+'}${Math.abs(daysUntil)}`;

  const questionsLabel = t('visitQuestions.manual.title');
  return (
    <View testID="overview-next-visit-panel">
      <View
        testID={nextAppointment ? 'overview-next-appointment' : undefined}
        style={styles.content}
      >
        <Text
          accessibilityRole="header"
          style={styles.label}
          testID="overview-next-visit-heading"
        >
          {t('overview.nextAppointment')}
        </Text>
        {appointmentState === 'loading' ? (
          <View
            style={nextAppointment ? styles.refreshRow : styles.initialRead}
          >
            {!nextAppointment ? (
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.placeholder}
              />
            ) : null}
            <View style={styles.refreshRow}>
              <AppProgress accessibilityElementsHidden />
              <Text
                accessibilityLiveRegion="polite"
                testID="overview-appointment-loading"
              >
                {t('appointments.loading')}
              </Text>
            </View>
          </View>
        ) : appointmentState === 'failed' ? (
          <View style={styles.inlineState}>
            <Text accessibilityRole="alert">{t('appointments.loadError')}</Text>
            <AppButton
              onPress={onRetryAppointments}
              testID="overview-appointments-retry"
              title={t('appointments.retry')}
            />
          </View>
        ) : null}
        {nextAppointment ? (
          <>
            <View style={styles.details} testID="overview-next-visit-details">
              <View
                style={styles.titleRow}
                testID="overview-next-visit-title-row"
              >
                {/* Let a long title wrap without shifting the fixed countdown below it. */}
                <Text
                  style={styles.clinic}
                  testID="overview-next-appointment-clinic"
                >
                  {nextAppointment.clinicLabel ??
                    nextAppointment.calendarEventSnapshot?.title ??
                    t('appointments.fallbackTitle')}
                </Text>
                {countdown ? (
                  <Text
                    style={styles.countdown}
                    testID="overview-next-visit-countdown"
                  >
                    {countdown}
                  </Text>
                ) : null}
              </View>
              <View
                style={styles.timeRow}
                testID="overview-next-visit-time-row"
              >
                <AppSymbol
                  name="calendar"
                  size={17}
                  color={appColors.secondary}
                />
                <Text style={styles.time} testID="overview-next-visit-time">
                  {appointmentTimeLabel(nextAppointment)}
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={questionsLabel}
              onPress={onPrepareVisit}
              style={styles.preparationAction}
              testID="overview-prepare-visit"
            >
              <Text style={styles.preparationLabel}>{questionsLabel}</Text>
              <AppSymbol
                name="chevron.right"
                size={12}
                color={appColors.primaryText}
              />
            </Pressable>
            {children}
          </>
        ) : appointmentState === 'ready' ? (
          <Pressable
            accessibilityRole="button"
            onPress={onOpenSchedule}
            style={styles.emptyAppointment}
            testID="overview-open-schedule"
          >
            <Text style={styles.emptyText}>{t('overview.noAppointment')}</Text>
            <AppSymbol
              name="chevron.right"
              size={14}
              color={appColors.secondary}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 8, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: {
    color: appColors.secondary,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  countdown: {
    flexShrink: 0,
    color: appColors.primaryText,
    backgroundColor: appColors.primarySoft,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 13,
    fontWeight: '600',
  },
  details: { gap: 8 },
  clinic: { color: appColors.text, flex: 1, fontSize: 28, fontWeight: '700' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  time: { color: appColors.secondary, flexShrink: 1, fontSize: 16 },
  preparationAction: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    maxWidth: '100%',
    minHeight: 44,
    minWidth: 44,
  },
  preparationLabel: {
    color: appColors.primaryText,
    flexShrink: 1,
    fontSize: 17,
    fontWeight: '600',
  },
  emptyAppointment: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 44,
  },
  emptyText: { color: appColors.secondary, flexShrink: 1, fontSize: 15 },
  inlineState: { gap: 8 },
  initialRead: { minHeight: 84, gap: 10, justifyContent: 'center' },
  refreshRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  placeholder: {
    width: '45%',
    height: 16,
    borderRadius: 8,
    backgroundColor: appColors.border,
  },
});
