import { Button, ScrollView, Text, View } from 'react-native';
import type { Appointment, AppointmentRepository } from '@orot/storage';
import { t } from '../i18n';
import { formatCalendarEventRange } from './dateTime';
import { calendarStyles as styles } from './calendarStyles';
import type { CalendarAccessState, CalendarBridge, CalendarEvent } from './types';
import { useCalendarLinking } from './useCalendarLinking';

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

function nextVisitView(appointment: Appointment) {
  const snapshot = appointment.calendarEventSnapshot;
  if (!snapshot) return null;
  return (
    <View style={styles.card} testID="calendar-next-visit">
      <Text style={styles.message}>{t('calendar.nextVisit')}</Text>
      <Text style={styles.eventTitle} testID="calendar-next-visit-title">
        {snapshot.title || t('calendar.eventNoTitle')}
      </Text>
      <Text testID="calendar-next-visit-time">
        {formatCalendarEventRange({
          calendarEventIdentifier: appointment.calendarEventIdentifier ?? '',
          effectiveAt: appointment.effectiveAt,
          endsAt: appointment.endsAt ?? appointment.effectiveAt,
          calendarEventSnapshot: snapshot,
        })}
      </Text>
    </View>
  );
}

function eventCard(
  event: CalendarEvent,
  onSelect: (event: CalendarEvent) => void,
) {
  return (
    <View key={`${event.calendarEventIdentifier}-${event.calendarEventSnapshot.occurrenceDate ?? event.effectiveAt}`}>
      <Text style={styles.eventTitle}>
        {event.calendarEventSnapshot.title || t('calendar.eventNoTitle')}
      </Text>
      <Text>{formatCalendarEventRange(event)}</Text>
      <Button
        onPress={() => onSelect(event)}
        testID={`calendar-candidate-${event.calendarEventIdentifier}`}
        title={t('calendar.selectEvent')}
      />
    </View>
  );
}

export default function CalendarLinkingScreen({
  repository,
  bridge,
  onBack,
  onOpenRecording,
}: CalendarLinkingScreenProps) {
  const calendar = useCalendarLinking(repository, bridge);

  return (
    <ScrollView contentContainerStyle={styles.container} testID="calendar-screen">
      {onBack ? (
        <Button onPress={onBack} testID="calendar-back" title={t('calendar.back')} />
      ) : null}
      <Text accessibilityRole="header" style={styles.title} testID="calendar-title">
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
        <Text testID="calendar-storage-loading">{t('appointments.opening')}</Text>
      ) : calendar.error === t('appointments.loadError') ? (
        <Button
          onPress={calendar.reloadAppointments}
          title={t('appointments.retry')}
        />
      ) : null}

      {calendar.nextVisitAppointment
        ? nextVisitView(calendar.nextVisitAppointment)
        : null}
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
        <Text accessibilityRole="alert" style={styles.error} testID="calendar-error">
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
          onPress={calendar.loadUpcomingEvents}
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
      {!calendar.loadingEvents &&
      calendar.access === 'fullAccess' &&
      calendar.events.length === 0 &&
      !calendar.selectedEvent ? (
        <Text testID="calendar-empty">{t('calendar.empty')}</Text>
      ) : null}
      {!calendar.loadingEvents &&
      calendar.events.length > 0 &&
      !calendar.selectedEvent ? (
        <View style={styles.card}>
          <Text style={styles.message}>{t('calendar.candidateHint')}</Text>
          {calendar.events.map(event =>
            eventCard(event, calendar.selectEvent),
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}
