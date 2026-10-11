import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import { t } from '../i18n';
import { CalendarMonthView } from './CalendarMonthView';
import { formatCalendarEventRange } from './dateTime';
import { calendarQueryWindow } from './calendarMonth';
import type { CalendarQueryWindow } from './calendarMonth';
import { CalendarQuickActions } from './CalendarQuickActions';
import { calendarStyles as styles } from './calendarStyles';
import type { CalendarBridge } from './types';
import { calendarAccessMessage as accessMessage } from './calendarAccessMessage';
import { useCalendarLinking } from './useCalendarLinking';
import { BottomNavigationMenu } from '../navigation/BottomNavigationMenu';
import { navigationText } from '../i18n/navigation';
import { useCalendarNavigationLeaveState } from './useCalendarNavigationLeaveState';

// EventKit's current query returns at most 100 upcoming events.
const CALENDAR_QUERY_RESULT_LIMIT = 100;

interface CalendarLinkingScreenProps {
  repository: AppointmentRepository;
  bridge: CalendarBridge;
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
  heading = t('calendar.title'),
  onOpenAppointments,
  onOpenMedicalAppointments,
  onAppointmentsChanged,
  onBack,
  onHome,
  onOpenRecording,
}: CalendarLinkingScreenProps) {
  const navigationInset = useNavigationContentInset();
  const calendar = useCalendarLinking(repository, bridge);
  const [queryWindow, setQueryWindow] = useState<CalendarQueryWindow | null>(
    null,
  );
  const selectedEventIdentifier =
    calendar.selectedEvent?.calendarEventIdentifier ?? null;
  const lastNotice = useRef('');
  const hasUnsavedSelection = useCalendarNavigationLeaveState({
    saving: calendar.saving,
    selectedEventIdentifier,
    notice: calendar.notice,
  });

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

  async function loadUpcomingEvents() {
    // Empty-day copy is only valid inside the native bridge's one-year query window.
    setQueryWindow(calendarQueryWindow(new Date()));
    await calendar.loadUpcomingEvents();
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.container, navigationInset]}
        testID="calendar-screen"
      >
        <Text
          accessibilityRole="header"
          style={styles.title}
          testID="calendar-title"
        >
          {heading}
        </Text>
        <CalendarQuickActions
          disabled={calendar.saving || hasUnsavedSelection}
          onOpenAppointments={onOpenAppointments}
          onOpenMedicalAppointments={onOpenMedicalAppointments}
        />
        <View style={styles.calendarPrivacyInfo}>
          <Text style={styles.message}>{t('calendar.description')}</Text>
          <Text style={styles.message}>
            {t('calendar.permissionExplanation')}
          </Text>
        </View>
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
        {calendar.access && calendar.access !== 'fullAccess' ? (
          <Text
            accessibilityRole="alert"
            style={styles.error}
            testID="calendar-access-state"
          >
            {accessMessage(calendar.access)}
          </Text>
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

        {calendar.selectedEvent ? (
          <View style={styles.card} testID="calendar-selection">
            <Text>
              {calendar.linkedAppointment
                ? t('calendar.reconfirmPrompt')
                : t('calendar.confirmPrompt')}
            </Text>
            <Text style={styles.eventTitle}>
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
        ) : null}

        {!calendar.selectedEvent ? (
          <Button
            disabled={calendar.loadingEvents || calendar.loadingAppointments}
            onPress={loadUpcomingEvents}
            testID="calendar-connect"
            title={
              calendar.loadingEvents
                ? t('calendar.loading')
                : t(
                    calendar.linkedAppointment
                      ? 'calendar.chooseAnother'
                      : 'calendar.connect',
                  )
            }
          />
        ) : null}

        {calendar.loadingEvents ? (
          <Text testID="calendar-loading-events">{t('calendar.loading')}</Text>
        ) : null}
        <CalendarMonthView
          appointmentsLoading={calendar.loadingAppointments}
          candidatesLoaded={calendar.hasLoadedCandidates}
          events={calendar.events}
          linkedAppointment={calendar.nextVisitAppointment}
          onSelectEvent={calendar.selectEvent}
          queryWindow={queryWindow}
          resultsMayBeIncomplete={
            calendar.events.length >= CALENDAR_QUERY_RESULT_LIMIT
          }
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
