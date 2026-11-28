import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { CalendarAccessibleDates } from './CalendarAccessibleDates';
import { CalendarDateCoverage } from './CalendarDateCoverage';
import type { Appointment } from '@orot/storage';
import {
  calendarDateKey,
  calendarEventDayRange,
  calendarMonthGrid,
  shiftCalendarMonth,
  type CalendarQueryWindow,
} from './calendarMonth';
import {
  eventFromAppointment,
  projectCalendarMonthEvents,
  type CalendarMonthDisplayEvent,
} from './calendarMonthEvents';
import {
  CalendarMonthHeader,
  CalendarWeekdayHeader,
} from './CalendarMonthHeader';
import {
  CalendarDayCell,
  calendarDayAccessibilityLabel,
} from './CalendarMonthCells';
import { calendarStyles as styles } from './calendarStyles';
import { CalendarSelectedDateAgenda } from './CalendarSelectedDateAgenda';
import { ScheduleMonthGrid } from './ScheduleMonthGrid';
import type { CalendarEvent } from './types';
interface CalendarMonthViewProps {
  flat?: boolean;
  appointmentsLoading: boolean;
  candidatesLoaded: boolean;
  events: readonly CalendarEvent[];
  initialDate?: Date;
  linkedAppointment: Appointment | null;
  selectedEvent?: CalendarEvent | null;
  selectionDisabled?: boolean;
  onSelectEvent: (event: CalendarEvent) => void;
  queryWindow: CalendarQueryWindow | null;
  resultsMayBeIncomplete: boolean;
}
function localDateKey(date: Date): string {
  return calendarDateKey(date.getFullYear(), date.getMonth(), date.getDate());
}
export function CalendarMonthView({
  flat = false,
  appointmentsLoading,
  candidatesLoaded,
  events,
  initialDate = new Date(),
  linkedAppointment,
  selectedEvent = null,
  selectionDisabled = false,
  onSelectEvent,
  queryWindow,
  resultsMayBeIncomplete,
}: CalendarMonthViewProps) {
  const { fontScale, width } = useWindowDimensions();
  const accessibleDates = fontScale > 1.5;
  const initialDateKey = localDateKey(initialDate);
  const todayDateKey = localDateKey(new Date());
  const [selectedDate, setSelectedDate] = useState(initialDateKey);
  const [visibleMonth, setVisibleMonth] = useState(() => ({
    year: initialDate.getFullYear(),
    month: initialDate.getMonth(),
  }));
  const focusedAppointment = useRef(false);
  const focusedCandidateList = useRef(false);
  const linkedEvent = useMemo(
    () => eventFromAppointment(linkedAppointment),
    [linkedAppointment],
  );
  const displayEvents = useMemo(
    () => projectCalendarMonthEvents(events, linkedAppointment),
    [events, linkedAppointment],
  );
  const rangedEvents = useMemo(
    () =>
      displayEvents.flatMap(item => {
        const range = calendarEventDayRange(item.event);
        return range ? [{ ...item, ...range }] : [];
      }),
    [displayEvents],
  );
  const gridDays = useMemo(
    () => calendarMonthGrid(visibleMonth.year, visibleMonth.month),
    [visibleMonth],
  );
  const focusDate = useCallback((dateKey: string) => {
    setSelectedDate(dateKey);
    const [year, month] = dateKey.split('-').map(Number);
    setVisibleMonth({ year, month: month - 1 });
  }, []);
  useEffect(() => {
    if (appointmentsLoading || focusedAppointment.current) return;
    focusedAppointment.current = true;
    const range = linkedEvent ? calendarEventDayRange(linkedEvent) : null;
    if (range) focusDate(range.startDay);
  }, [appointmentsLoading, focusDate, linkedEvent]);
  useEffect(() => {
    if (!candidatesLoaded || focusedCandidateList.current) return;
    focusedCandidateList.current = true;
    if (linkedEvent || rangedEvents.length === 0) return;
    focusDate(rangedEvents[0].startDay);
  }, [candidatesLoaded, focusDate, linkedEvent, rangedEvents]);
  function moveMonth(amount: number) {
    const target = shiftCalendarMonth(
      visibleMonth.year,
      visibleMonth.month,
      amount,
    );
    const lastDay = new Date(
      Date.UTC(target.year, target.month + 1, 0),
    ).getUTCDate();
    focusDate(
      calendarDateKey(
        target.year,
        target.month,
        Math.min(Number(selectedDate.slice(-2)), lastDay),
      ),
    );
  }
  function eventsForDay(dateKey: string): CalendarMonthDisplayEvent[] {
    return rangedEvents.filter(
      item => item.startDay <= dateKey && dateKey <= item.endDay,
    );
  }
  const eventsOnSelectedDate = eventsForDay(selectedDate);
  const selectedDateOutsideQuery =
    candidatesLoaded &&
    queryWindow !== null &&
    (selectedDate < queryWindow.startDay || selectedDate >= queryWindow.endDay);
  const showNoReturnedEvents =
    candidatesLoaded &&
    !selectedDateOutsideQuery &&
    !resultsMayBeIncomplete &&
    eventsOnSelectedDate.length === 0;
  return (
    <View
      style={[styles.calendarMonth, flat && styles.flatMonth]}
      testID="calendar-month-view"
    >
      <CalendarMonthHeader
        flat={flat}
        year={visibleMonth.year}
        month={visibleMonth.month}
        onMoveMonth={moveMonth}
      />
      <View
        style={styles.calendarDateGridContent}
        testID="calendar-date-grid-content"
      >
        {flat ? (
          <ScheduleMonthGrid
            days={gridDays}
            eventsForDay={eventsForDay}
            focusDate={focusDate}
            focusedDate={selectedDate}
            todayDate={todayDateKey}
            width={width}
            largeText={accessibleDates}
            selectedEvent={selectedEvent}
            selectionDisabled={selectionDisabled}
            selectEvent={onSelectEvent}
          />
        ) : accessibleDates ? (
          <CalendarAccessibleDates
            days={gridDays}
            eventsForDay={eventsForDay}
            selectedDate={selectedDate}
            todayDate={todayDateKey}
            onSelect={focusDate}
          />
        ) : (
          <>
            <CalendarWeekdayHeader />
            <View style={styles.calendarGrid} testID="calendar-date-grid">
              {gridDays.map(day => {
                const dayEvents = eventsForDay(day.dateKey);
                return (
                  <CalendarDayCell
                    day={day}
                    dayEvents={dayEvents}
                    key={day.dateKey}
                    label={calendarDayAccessibilityLabel(
                      day.dateKey,
                      dayEvents,
                      day.dateKey === todayDateKey,
                    )}
                    onPress={focusDate}
                    selected={day.dateKey === selectedDate}
                    today={day.dateKey === todayDateKey}
                  />
                );
              })}
            </View>
          </>
        )}
      </View>
      {flat ? (
        <CalendarDateCoverage
          selectedDateOutsideQuery={selectedDateOutsideQuery}
          incomplete={candidatesLoaded && resultsMayBeIncomplete}
          empty={false}
        />
      ) : (
        <CalendarSelectedDateAgenda
          selectedDate={selectedDate}
          selectedDateOutsideQuery={selectedDateOutsideQuery}
          incomplete={candidatesLoaded && resultsMayBeIncomplete}
          showNoReturnedEvents={showNoReturnedEvents}
          eventsOnSelectedDate={eventsOnSelectedDate}
          selectedEvent={selectedEvent}
          onSelectEvent={onSelectEvent}
          selectionDisabled={selectionDisabled}
          candidatesLoaded={candidatesLoaded}
        />
      )}
    </View>
  );
}
