import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { Appointment } from '@orot/storage';
import { DesignText } from '../design';
import { t } from '../i18n';
import {
  calendarDateKey,
  calendarEventDayRange,
  calendarMonthGrid,
  formatCalendarDate,
  shiftCalendarMonth,
} from './calendarMonth';
import type { CalendarQueryWindow } from './calendarMonth';
import {
  eventFromAppointment,
  projectCalendarMonthEvents,
} from './calendarMonthEvents';
import type { CalendarMonthDisplayEvent } from './calendarMonthEvents';
import { CalendarMonthHeader } from './CalendarMonthHeader';
import {
  CalendarDayCell,
  CalendarMonthEventRow,
  calendarDayAccessibilityLabel,
} from './CalendarMonthCells';
import { useCalendarStyles } from './calendarStyles';
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
  const styles = useCalendarStyles();
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
  const displayEvents = useMemo<CalendarMonthDisplayEvent[]>(() => {
    return projectCalendarMonthEvents(events, linkedAppointment);
  }, [events, linkedAppointment]);
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
  const showNoReturnedEvents =
    candidatesLoaded &&
    !selectedDateOutsideQuery &&
    !resultsMayBeIncomplete &&
    eventsOnSelectedDate.length === 0;

  return (
    <View style={styles.calendarMonth} testID="calendar-month-view">
      <ScrollView
        horizontal
        contentContainerStyle={styles.calendarScrollContent}
      >
        <View style={styles.calendarDates} testID="calendar-date-content">
          <CalendarMonthHeader
            year={visibleMonth.year}
            month={visibleMonth.month}
            onMoveMonth={moveMonth}
            styles={styles}
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
                  styles={styles}
                />
              );
            })}
          </View>
        </View>
      </ScrollView>
      <View style={styles.calendarSelectedDateEvents}>
        <DesignText
          accessibilityRole="header"
          style={styles.calendarSelectedDate}
          testID="calendar-selected-date"
          variant="heading"
        >
          {formatCalendarDate(selectedDate)}
        </DesignText>
        {selectedDateOutsideQuery ? (
          <DesignText
            style={styles.calendarNotice}
            testID="calendar-outside-query"
            tone="warning"
            variant="caption"
          >
            {t('calendar.outsideQueryRange')}
          </DesignText>
        ) : null}
        {candidatesLoaded && resultsMayBeIncomplete ? (
          <DesignText
            style={styles.calendarNotice}
            testID="calendar-result-limit"
            tone="warning"
            variant="caption"
          >
            {t('calendar.resultsMayBeIncomplete')}
          </DesignText>
        ) : null}
        {showNoReturnedEvents ? (
          <>
            <DesignText testID="calendar-empty" variant="body">
              {t('calendar.empty')}
            </DesignText>
            <DesignText
              style={styles.calendarNotice}
              testID="calendar-empty-query-note"
              tone="warning"
              variant="caption"
            >
              {t('calendar.emptyQueryNote')}
            </DesignText>
          </>
        ) : null}
        {candidatesLoaded &&
        eventsOnSelectedDate.some(item => item.canSelect) ? (
          <DesignText style={styles.message} tone="secondary" variant="body">
            {t('calendar.candidateHint')}
          </DesignText>
        ) : null}
        <View testID="calendar-events-for-selected-date">
          {eventsOnSelectedDate.map(item => (
            <CalendarMonthEventRow
              item={item}
              key={item.rowKey}
              onSelectEvent={onSelectEvent}
              styles={styles}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
