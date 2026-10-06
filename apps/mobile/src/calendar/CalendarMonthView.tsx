import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { Appointment } from '@orot/storage';
import { t } from '../i18n';
import {
  calendarDateKey,
  calendarEventDayRange,
  calendarMonthGrid,
  formatCalendarDate,
  shiftCalendarMonth,
} from './calendarMonth';
import type { CalendarQueryWindow } from './calendarMonth';
import { CalendarMonthHeader } from './CalendarMonthHeader';
import {
  CalendarDayCell,
  CalendarMonthEventRow,
  calendarDayAccessibilityLabel,
  type CalendarMonthDisplayEvent,
} from './CalendarMonthCells';
import { calendarStyles as styles } from './calendarStyles';
import type { CalendarEvent } from './types';

interface CalendarMonthViewProps {
  appointmentsLoading: boolean;
  candidatesLoaded: boolean;
  events: CalendarEvent[];
  initialDate?: Date;
  linkedAppointment: Appointment | null;
  onSelectEvent: (event: CalendarEvent) => void;
  queryWindow: CalendarQueryWindow | null;
  resultsMayBeIncomplete: boolean;
}

function localDateKey(date: Date): string {
  return calendarDateKey(date.getFullYear(), date.getMonth(), date.getDate());
}

function eventFromAppointment(
  appointment: Appointment | null,
): CalendarEvent | null {
  if (
    !appointment?.calendarEventIdentifier ||
    !appointment.calendarEventSnapshot
  ) {
    return null;
  }
  return {
    calendarEventIdentifier: appointment.calendarEventIdentifier,
    effectiveAt: appointment.effectiveAt,
    endsAt: appointment.endsAt ?? appointment.effectiveAt,
    calendarEventSnapshot: appointment.calendarEventSnapshot,
  };
}

function occurrenceKey(event: CalendarEvent): string {
  const snapshot = event.calendarEventSnapshot;
  return `${event.calendarEventIdentifier}:${snapshot.floatingOccurrenceAt ?? snapshot.occurrenceDate ?? event.effectiveAt}`;
}

function dateNumber(dateKey: string): number {
  return Number(dateKey.slice(-2));
}

export function CalendarMonthView({
  appointmentsLoading,
  candidatesLoaded,
  events,
  initialDate = new Date(),
  linkedAppointment,
  onSelectEvent,
  queryWindow,
  resultsMayBeIncomplete,
}: CalendarMonthViewProps) {
  const initialDateKey = localDateKey(initialDate);
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
  // Project the saved appointment for display; candidate access and confirmation stay in the existing hook.
  const displayEvents = useMemo<CalendarMonthDisplayEvent[]>(() => {
    const candidates = events.map(event => ({
      event,
      isNextVisit:
        linkedEvent !== null &&
        occurrenceKey(event) === occurrenceKey(linkedEvent),
      canSelect: true,
    }));
    if (linkedEvent && !candidates.some(candidate => candidate.isNextVisit)) {
      candidates.push({
        event: linkedEvent,
        isNextVisit: true,
        canSelect: false,
      });
    }
    return candidates.sort(
      (left, right) =>
        new Date(left.event.effectiveAt).getTime() -
        new Date(right.event.effectiveAt).getTime(),
    );
  }, [events, linkedEvent]);
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
  const eventsOnSelectedDate = rangedEvents.filter(
    item => item.startDay <= selectedDate && selectedDate <= item.endDay,
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
        Math.min(dateNumber(selectedDate), lastDay),
      ),
    );
  }

  function eventsForDay(dateKey: string): CalendarMonthDisplayEvent[] {
    return rangedEvents.filter(
      item => item.startDay <= dateKey && dateKey <= item.endDay,
    );
  }

  const selectedDateOutsideQuery =
    candidatesLoaded &&
    queryWindow !== null &&
    (selectedDate < queryWindow.startDay || selectedDate >= queryWindow.endDay);
  const showEmptyDate =
    candidatesLoaded &&
    !selectedDateOutsideQuery &&
    !resultsMayBeIncomplete &&
    eventsOnSelectedDate.length === 0;

  return (
    <View style={styles.calendarMonth} testID="calendar-month-view">
      <CalendarMonthHeader
        year={visibleMonth.year}
        month={visibleMonth.month}
        onMoveMonth={moveMonth}
      />
      <View style={styles.calendarGrid} testID="calendar-date-grid">
        {gridDays.map(day => {
          const dayEvents = eventsForDay(day.dateKey);
          return (
            <CalendarDayCell
              day={day}
              dayEvents={dayEvents}
              key={day.dateKey}
              label={calendarDayAccessibilityLabel(day.dateKey, dayEvents)}
              onPress={focusDate}
              selected={day.dateKey === selectedDate}
            />
          );
        })}
      </View>
      <View style={styles.calendarSelectedDateEvents}>
        <Text
          accessibilityRole="header"
          style={styles.calendarSelectedDate}
          testID="calendar-selected-date"
        >
          {formatCalendarDate(selectedDate)}
        </Text>
        {selectedDateOutsideQuery ? (
          <Text style={styles.calendarNotice} testID="calendar-outside-query">
            {t('calendar.outsideQueryRange')}
          </Text>
        ) : null}
        {candidatesLoaded && resultsMayBeIncomplete ? (
          <Text style={styles.calendarNotice} testID="calendar-result-limit">
            {t('calendar.resultsMayBeIncomplete')}
          </Text>
        ) : null}
        {showEmptyDate ? (
          <Text testID="calendar-empty">{t('calendar.empty')}</Text>
        ) : null}
        {candidatesLoaded &&
        eventsOnSelectedDate.some(item => item.canSelect) ? (
          <Text style={styles.message}>{t('calendar.candidateHint')}</Text>
        ) : null}
        <View testID="calendar-events-for-selected-date">
          {eventsOnSelectedDate.map(item => (
            <CalendarMonthEventRow
              item={item}
              key={occurrenceKey(item.event)}
              onSelectEvent={onSelectEvent}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
