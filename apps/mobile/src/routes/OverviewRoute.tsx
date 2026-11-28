import { OverviewPreparedVisits } from './OverviewPreparedVisits';
import type { AiFeatureServices } from '../aiFeatures/integration/featureServiceTypes';
import { SettingsPageHeading as PageHeading } from '../layout/SettingsPageHeading';
import { settingsPageStyles } from '../layout/settingsPagePresentation';
import { StyleSheet, View } from 'react-native';
import type { Appointment } from '@orot/storage';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { hubSpacing } from '../layout/hubSpacing';
import { NAVIGATION_CONTENT_GAP } from '../navigation/navigationLayout';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { OverviewNextVisitCard } from './OverviewNextVisitCard';
import { ChartTooltipHost } from '../ui/charts/ChartTooltipHost';
import { OverviewMetrics } from './overview/OverviewMetrics';
import type { OverviewPreparationLoaders } from './useOverviewPreparationData';

export interface OverviewRouteProps extends OverviewPreparationLoaders {
  readonly discoverManualVisits?: AiFeatureServices['conversationArtifacts'];
  readonly appointment: Appointment | null;
  readonly appointmentState: 'loading' | 'ready' | 'failed';
  readonly onRetryAppointments: () => void;
  readonly onPrepareVisit: () => void;
  readonly onOpenSchedule: () => void;
  readonly onEditMetricSelection: () => void;
}

/** Keeps visit preparation and health metrics in one ordered page. */
export default function OverviewRoute({
  appointment,
  appointmentState,
  onRetryAppointments,
  onPrepareVisit,
  onOpenSchedule,
  onEditMetricSelection,
  discoverManualVisits,
}: OverviewRouteProps) {
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });

  return (
    <ChartTooltipHost style={styles.container} testID="overview-screen">
      <PageHeading testID="overview-title">{t('overview.title')}</PageHeading>
      {/* The shell consumes system/navigation geometry once and owns the only vertical scroll. */}
      <View style={styles.sections} testID="overview-overview-sections">
        <OverviewNextVisitCard
          appointment={appointment}
          appointmentState={appointmentState}
          onOpenSchedule={onOpenSchedule}
          onPrepareVisit={onPrepareVisit}
          onRetryAppointments={onRetryAppointments}
        />
        <OverviewPreparedVisits
          appointmentId={appointment?.id}
          discover={discoverManualVisits}
        />
        <OverviewMetrics onEdit={onEditMetricSelection} />
      </View>
    </ChartTooltipHost>
  );
}

const styles = StyleSheet.create({
  container: {
    // Let the shared ScrollView measure long Dynamic Type content past its viewport.
    gap: 24,
    ...settingsPageStyles.inset,
    // The outer route scroller already contributes the shared navigation gap.
    paddingBottom: hubSpacing.bottom - NAVIGATION_CONTENT_GAP,
    backgroundColor: appColors.background,
  },
  sections: { gap: 24, minWidth: 0 },
});

// Keep shared error-route styling available to CalendarAppRoute while using the Toss palette.
export const appRouteStyles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    backgroundColor: appColors.background,
  },
  title: {
    color: appColors.text,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    color: appColors.secondary,
    fontSize: 16,
    textAlign: 'center',
  },
});
