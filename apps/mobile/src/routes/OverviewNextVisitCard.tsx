import { Pressable, StyleSheet, View } from 'react-native';
import type { Appointment } from '@orot/storage';
import { AppButton } from '../layout/AppButton';
import { AppProgress } from '../layout/AppProgress';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import {
  UpcomingVisitDetails,
  UpcomingVisitHeading,
  upcomingVisitSectionStyle,
} from '../layout/UpcomingVisitHeading';
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
  const questionsLabel = t('visitQuestions.manual.title');
  return (
    <View testID="overview-next-visit-panel">
      <View
        testID={nextAppointment ? 'overview-next-appointment' : undefined}
        style={upcomingVisitSectionStyle}
      >
        <UpcomingVisitHeading
          label={t('overview.nextAppointment')}
          testID="overview-next-visit-heading"
        />
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
            <UpcomingVisitDetails
              title={
                nextAppointment.clinicLabel ??
                nextAppointment.calendarEventSnapshot?.title ??
                t('appointments.fallbackTitle')
              }
              time={appointmentTimeLabel(nextAppointment)}
              startsAt={nextAppointment.effectiveAt}
              testIDs={{
                details: 'overview-next-visit-details',
                titleRow: 'overview-next-visit-title-row',
                title: 'overview-next-appointment-clinic',
                countdown: 'overview-next-visit-countdown',
                timeRow: 'overview-next-visit-time-row',
                time: 'overview-next-visit-time',
              }}
            />
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
