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

/** Keeps visit details, saved-question guidance and recovery before the explicit compact preparation action. */
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

  return (
    <View style={styles.appointment} testID="overview-next-visit-panel">
      <View
        testID={nextAppointment ? 'overview-next-appointment' : undefined}
        style={styles.content}
      >
        <View style={styles.heading} testID="overview-next-visit-heading">
          <View style={styles.headingLabel}>
            <AppSymbol
              name="calendar"
              size={16}
              color={appColors.primaryText}
            />
            <Text accessibilityRole="header" style={styles.label}>
              {t('overview.nextAppointment')}
            </Text>
          </View>
          {countdown ? (
            <Text
              style={styles.countdown}
              testID="overview-next-visit-countdown"
            >
              {countdown}
            </Text>
          ) : null}
        </View>
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
              {/* The name retains its full text at narrow widths and large Dynamic Type sizes. */}
              <Text
                style={styles.clinic}
                testID="overview-next-appointment-clinic"
              >
                {nextAppointment.clinicLabel ??
                  nextAppointment.calendarEventSnapshot?.title ??
                  t('appointments.fallbackTitle')}
              </Text>
              <Text style={styles.time} testID="overview-next-visit-time">
                {appointmentTimeLabel(nextAppointment)}
              </Text>
            </View>
            {children}
            <AppButton
              onPress={onPrepareVisit}
              variant="text"
              size="compact"
              style={styles.preparationAction}
              trailingContent={
                <AppSymbol
                  name="chevron.right"
                  size={12}
                  color={appColors.primaryText}
                />
              }
              testID="overview-prepare-visit"
              title={t('visitDayQuestions.open')}
            />
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
  appointment: {
    backgroundColor: appColors.surface,
    borderRadius: 16,
    padding: 16,
  },
  content: { gap: 10, minWidth: 0 },
  heading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headingLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: 6,
  },
  label: {
    color: appColors.secondary,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  countdown: {
    alignSelf: 'flex-start',
    color: appColors.primaryText,
    backgroundColor: appColors.primarySoft,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 13,
    fontWeight: '600',
  },
  details: { gap: 4 },
  clinic: { color: appColors.text, fontSize: 20, fontWeight: '700' },
  time: { color: appColors.secondary, fontSize: 14 },
  preparationAction: { alignSelf: 'flex-start', maxWidth: '100%' },
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
