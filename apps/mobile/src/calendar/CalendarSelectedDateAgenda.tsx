import { View } from 'react-native';
import { t } from '../i18n';
import { AppText as Text } from '../layout/AppText';
import { CalendarDateCoverage } from './CalendarDateCoverage';
import { CalendarMonthEventRow } from './CalendarMonthCells';
import { calendarStyles as styles } from './calendarStyles';
import { formatCalendarDate } from './calendarMonth';
import type { CalendarMonthDisplayEvent } from './calendarMonthEvents';
import { calendarEventsEqual } from './calendarSnapshot';
import type { CalendarEvent } from './types';

interface DateAgendaProps {
  selectedDate: string;
  selectedDateOutsideQuery: boolean;
  incomplete: boolean;
  showNoReturnedEvents: boolean;
  eventsOnSelectedDate: readonly CalendarMonthDisplayEvent[];
  selectedEvent: CalendarEvent | null;
  onSelectEvent: (event: CalendarEvent) => void;
  selectionDisabled: boolean;
  candidatesLoaded: boolean;
}

/** Standalone Calendar linking retains its original selected-day agenda. */
export function CalendarSelectedDateAgenda({
  selectedDate,
  selectedDateOutsideQuery,
  incomplete,
  showNoReturnedEvents,
  eventsOnSelectedDate,
  selectedEvent,
  onSelectEvent,
  selectionDisabled,
  candidatesLoaded,
}: DateAgendaProps) {
  return (
    <View style={styles.calendarSelectedDateEvents}>
      <Text
        accessibilityRole="header"
        style={styles.calendarSelectedDate}
        testID="calendar-selected-date"
      >
        {formatCalendarDate(selectedDate)}
      </Text>
      <CalendarDateCoverage
        selectedDateOutsideQuery={selectedDateOutsideQuery}
        incomplete={incomplete}
        empty={showNoReturnedEvents}
      />
      <View
        style={styles.calendarSelectedEventList}
        testID="calendar-events-for-selected-date"
      >
        {eventsOnSelectedDate.map(item => {
          // A selected recurring event is one exact snapshot, not every matching calendar identifier.
          const selected =
            selectedEvent !== null &&
            calendarEventsEqual(item.event, selectedEvent);
          return (
            <CalendarMonthEventRow
              item={item}
              key={item.rowKey}
              onSelectEvent={onSelectEvent}
              selected={selected}
              selectionDisabled={selectionDisabled}
            />
          );
        })}
      </View>
      {candidatesLoaded && eventsOnSelectedDate.some(item => item.canSelect) ? (
        <Text style={styles.message}>{t('calendar.candidateHint')}</Text>
      ) : null}
    </View>
  );
}
