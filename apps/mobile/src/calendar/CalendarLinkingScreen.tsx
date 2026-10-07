import { useState } from 'react';
import { Button, ScrollView, Text, View } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import { t } from '../i18n';
import { CalendarMonthView } from './CalendarMonthView';
import { formatCalendarEventRange } from './dateTime';
import { calendarQueryWindow } from './calendarMonth';
import type { CalendarQueryWindow } from './calendarMonth';
import { calendarStyles as styles } from './calendarStyles';
import type { CalendarAccessState, CalendarBridge } from './types';
import { useCalendarLinking } from './useCalendarLinking';

// EventKit's current query returns at most 100 upcoming events.
const CALENDAR_QUERY_RESULT_LIMIT = 100;

interface CalendarLinkingScreenProps {
  repository: AppointmentRepository;
  bridge: CalendarBridge;
  onBack?: () => void;
  onOpenRecording?: () => void;
}

function accessMessage(access: CalendarAccessState | null): string {
  if (access === 'denied') return t('calendar.accessDenied');
  if (access === 'restricted') return t('calendar.accessRestricted');
  if (access === 'writeOnly') return t('calendar.fullAccessRequired');
  if (access === 'notDetermined') return t('calendar.tryAgainAfterPermission');
  return '';
}

export default function CalendarLinkingScreen({
  repository,
  bridge,
  onBack,
  onOpenRecording,
}: CalendarLinkingScreenProps) {
  const calendar = useCalendarLinking(repository, bridge);
  const [queryWindow, setQueryWindow] = useState<CalendarQueryWindow | null>(
    null,
  );

  async function loadUpcomingEvents() {
    // Empty-day copy is only valid inside the native bridge's one-year query window.
    setQueryWindow(calendarQueryWindow(new Date()));
    await calendar.loadUpcomingEvents();
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      testID="calendar-screen"
    >
      {onBack ? (
        <Button
          onPress={onBack}
          testID="calendar-back"
          title={t('calendar.back')}
        />
      ) : null}
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="calendar-title"
      >
        {t('calendar.title')}
      </Text>
      <Text style={styles.message}>{t('calendar.description')}</Text>
      <Text style={styles.message}>{t('calendar.permissionExplanation')}</Text>
      {onOpenRecording ? (
        <Button
          onPress={onOpenRecording}
          testID="open-recording"
          title={t('app.actions.recording')}
        />
      ) : null}

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
  );
}
