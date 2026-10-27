import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { useEffect, useRef } from 'react';
import { ScrollView, View } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import { t } from '../i18n';
import { CalendarMonthView } from './CalendarMonthView';
import { formatCalendarEventRange } from './dateTime';
import { calendarQueryWindowFromCoverage } from './calendarMonth';
import type { CalendarQueryWindow } from './calendarMonth';
import { CalendarQuickActions } from './CalendarQuickActions';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { calendarStyles as styles } from './calendarStyles';
import type { CalendarBridge } from './types';
import { emptyCalendarAutoSyncState } from './calendarAutoSync';
import type { CalendarAutoSyncState } from './calendarAutoSync';
import { useCalendarLinking } from './useCalendarLinking';
import { eventFromAppointment } from './calendarMonthEvents';
import { BottomNavigationMenu } from '../navigation/BottomNavigationMenu';
import { navigationText } from '../i18n/navigation';
import { useCalendarNavigationLeaveState } from './useCalendarNavigationLeaveState';

interface CalendarLinkingScreenProps {
  repository: AppointmentRepository;
  bridge: CalendarBridge;
  calendarSync?: CalendarAutoSyncState;
  adaptiveScheduleLayout?: boolean;
  heading?: string;
  onOpenAppointments?: () => void;
  onOpenMedicalAppointments?: () => void;
  onAppointmentsChanged?: () => void;
  onBack?: () => void;
  onHome?: () => void;
  onOpenRecording?: () => void;
}

export default function CalendarLinkingScreen({
  repository,
  bridge,
  calendarSync = emptyCalendarAutoSyncState,
  adaptiveScheduleLayout = false,
  heading = t('calendar.title'),
  onOpenAppointments,
  onOpenMedicalAppointments,
  onAppointmentsChanged,
  onBack,
  onHome,
  onOpenRecording,
}: CalendarLinkingScreenProps) {
  const navigationInset = useNavigationContentInset();
  const calendar = useCalendarLinking(repository, bridge, calendarSync);
  const queryWindow: CalendarQueryWindow | null = calendarSync.query
    ? calendarQueryWindowFromCoverage(calendarSync.query)
    : null;
  const selectedEventIdentifier =
    calendar.selectedEvent?.calendarEventIdentifier ?? null;
  const lastNotice = useRef('');
  const hasUnsavedSelection = useCalendarNavigationLeaveState({
    saving: calendar.saving,
    selectedEventIdentifier,
    notice: calendar.notice,
  });
  // Both calendar entry points use measured columns; only Schedule adds its saved-visit summary.
  const layoutRouteKey = adaptiveScheduleLayout ? 'schedule' : 'calendar';
  const adaptiveLayoutTestID = `${layoutRouteKey}-adaptive-columns`;
  const upcomingEvent = eventFromAppointment(calendar.nextVisitAppointment);
  // The saved-appointment panel belongs only to Schedule; other linking flows keep their prior layout.
  const selectionSummary = calendar.selectedEvent ? (
    <View style={styles.card} testID="calendar-selection">
      <Text>
        {calendar.linkedAppointment
          ? t('calendar.reconfirmPrompt')
          : t('calendar.confirmPrompt')}
      </Text>
      <Text style={styles.eventTitle} testID="calendar-selected-event-title">
        {calendar.selectedEvent.calendarEventSnapshot.title ||
          t('calendar.eventNoTitle')}
      </Text>
      <Text>{formatCalendarEventRange(calendar.selectedEvent)}</Text>
      <Button
        disabled={calendar.saving}
        onPress={calendar.confirmSelectedEvent}
        testID="calendar-confirm-selected"
        title={
          calendar.saving
            ? t('calendar.saving')
            : t(
                calendar.linkedAppointment
                  ? 'calendar.reconfirm'
                  : 'calendar.confirm',
              )
        }
      />
      <Button
        disabled={calendar.saving}
        onPress={calendar.clearSelection}
        title={t('calendar.cancelSelection')}
      />
    </View>
  ) : adaptiveScheduleLayout && upcomingEvent ? (
    <View style={styles.card} testID="schedule-next-visit-summary">
      <Text accessibilityRole="header">{t('calendar.nextVisit')}</Text>
      <Text style={styles.eventTitle} testID="schedule-next-visit-title">
        {upcomingEvent.calendarEventSnapshot.title ||
          t('calendar.eventNoTitle')}
      </Text>
      <Text testID="schedule-next-visit-time">
        {formatCalendarEventRange(upcomingEvent)}
      </Text>
    </View>
  ) : null;

  const calendarMonth = (
    <CalendarMonthView
      appointmentsLoading={calendar.loadingAppointments}
      candidatesLoaded={calendar.hasLoadedCandidates}
      events={calendar.events}
      linkedAppointment={calendar.nextVisitAppointment}
      onSelectEvent={calendar.selectEvent}
      queryWindow={queryWindow}
      resultsMayBeIncomplete={calendarSync.query?.complete === false}
    />
  );

  useEffect(() => {
    // Candidate events stay local until confirmation persists them as appointments.
    if (
      calendar.notice === t('calendar.confirmed') &&
      lastNotice.current !== calendar.notice
    ) {
      onAppointmentsChanged?.();
    }
    lastNotice.current = calendar.notice;
  }, [calendar.notice, onAppointmentsChanged]);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.container, navigationInset]}
        testID="calendar-screen"
      >
        {/* Calendar access and recovery details live in Settings, outside this passive schedule view. */}
        <View style={styles.heading}>
          <Text
            accessibilityRole="header"
            style={styles.title}
            testID="calendar-title"
          >
            {heading}
          </Text>
          <Text style={styles.subtitle} testID="schedule-subtitle">
            {t('schedule.subtitle')}
          </Text>
        </View>
        <CalendarQuickActions
          disabled={calendar.saving || hasUnsavedSelection}
          onOpenAppointments={onOpenAppointments}
          onOpenMedicalAppointments={onOpenMedicalAppointments}
        />
        {calendar.loadingAppointments ? (
          <Text testID="calendar-storage-loading">
            {t('appointments.opening')}
          </Text>
        ) : calendar.error === t('appointments.loadError') ? (
          <Button
            onPress={calendar.reloadAppointments}
            title={t('appointments.retry')}
          />
        ) : null}

        {calendar.pendingChange?.kind === 'changed' ? (
          <View style={styles.card} testID="calendar-change-warning">
            <Text style={styles.warning}>{t('calendar.eventChanged')}</Text>
            <Button
              onPress={calendar.reviewChangedEvent}
              testID="calendar-review-change"
              title={t('calendar.reviewChange')}
            />
          </View>
        ) : null}
        {calendar.pendingChange?.kind === 'missing' ? (
          <View style={styles.card} testID="calendar-missing-warning">
            <Text style={styles.warning}>{t('calendar.eventMissing')}</Text>
          </View>
        ) : null}
        {calendar.error ? (
          <Text
            accessibilityRole="alert"
            style={styles.error}
            testID="calendar-error"
          >
            {calendar.error}
          </Text>
        ) : null}
        {calendar.notice ? (
          <Text accessibilityLiveRegion="polite">{calendar.notice}</Text>
        ) : null}

        {/* Keep selection state above measured panels so route reflow changes only their geometry. */}
        <AdaptiveColumns
          primary={calendarMonth}
          routeKey={layoutRouteKey}
          secondary={selectionSummary}
          testID={adaptiveLayoutTestID}
        />
      </ScrollView>
      {/* Keep route controls outside the calendar scroller and inside its safe area. */}
      {onBack ? (
        <BottomNavigationMenu
          onBack={onBack}
          onHome={onHome}
          primaryAction={
            onOpenRecording
              ? {
                  label: navigationText.recording.label,
                  accessibilityLabel:
                    navigationText.recording.accessibilityLabel,
                  onPress: onOpenRecording,
                  testID: 'navigation-recording',
                }
              : undefined
          }
          testID="calendar-back"
          disabled={calendar.saving}
        />
      ) : null}
    </View>
  );
}
