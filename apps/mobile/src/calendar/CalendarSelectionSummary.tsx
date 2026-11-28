import { View } from 'react-native';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { formatCalendarEventRange } from './dateTime';
import { calendarStyles as styles } from './calendarStyles';
import { schedulePresentationStyles as scheduleStyles } from './schedulePresentationStyles';
import { eventFromAppointment } from './calendarMonthEvents';
import type { useCalendarLinking } from './useCalendarLinking';

type CalendarSelection = Pick<
  ReturnType<typeof useCalendarLinking>,
  | 'nextVisitAppointment'
  | 'selectedEvent'
  | 'linkedAppointment'
  | 'saving'
  | 'confirmSelectedEvent'
  | 'clearSelection'
>;

/** Presents the draft before the upcoming visit; confirmation still belongs to the calendar owner. */
export function CalendarSelectionSummary({
  calendar,
  showNextVisit,
  flat,
}: {
  readonly calendar: CalendarSelection;
  readonly showNextVisit: boolean;
  readonly flat: boolean;
}) {
  const upcomingEvent = eventFromAppointment(calendar.nextVisitAppointment);
  // The saved-appointment panel belongs only to Schedule; other linking flows keep their prior layout.
  return calendar.selectedEvent ? (
    <View
      style={flat ? styles.flatCard : styles.card}
      testID="calendar-selection"
    >
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
  ) : showNextVisit && upcomingEvent ? (
    <View
      style={flat ? scheduleStyles.flatNextVisit : styles.card}
      testID="schedule-next-visit-summary"
    >
      <Text
        accessibilityRole="header"
        style={flat ? styles.calendarSelectedDate : undefined}
      >
        {t('calendar.nextVisit')}
      </Text>
      <Text style={styles.eventTitle} testID="schedule-next-visit-title">
        {upcomingEvent.calendarEventSnapshot.title ||
          t('calendar.eventNoTitle')}
      </Text>
      <Text
        style={flat ? scheduleStyles.flatEventTime : undefined}
        testID="schedule-next-visit-time"
      >
        {formatCalendarEventRange(upcomingEvent)}
      </Text>
    </View>
  ) : null;
}
