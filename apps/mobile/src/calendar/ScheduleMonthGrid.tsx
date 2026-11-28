import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { AppText as Text } from '../layout/AppText';
import {
  CalendarDayCell,
  calendarDayAccessibilityLabel,
} from './CalendarMonthCells';
import { CalendarWeekdayHeader } from './CalendarMonthHeader';
import { ScheduleEventSheet } from './ScheduleEventSheet';
import { calendarStyles } from './calendarStyles';
import { calendarEventsEqual } from './calendarSnapshot';
import { formatCalendarDate, type CalendarGridDay } from './calendarMonth';
import type { CalendarMonthDisplayEvent } from './calendarMonthEvents';
import { formatCalendarEventRange, formatCalendarEventStart } from './dateTime';
import type { CalendarEvent } from './types';
import { useScheduleMonthGesture } from './useScheduleMonthGesture';

interface ScheduleMonthGridProps {
  readonly days: readonly CalendarGridDay[];
  readonly eventsForDay: (key: string) => CalendarMonthDisplayEvent[];
  readonly focusDate: (key: string) => void;
  readonly focusedDate: string;
  readonly todayDate: string;
  readonly width: number;
  readonly largeText: boolean;
  readonly selectedEvent: CalendarEvent | null;
  readonly selectionDisabled: boolean;
  readonly selectEvent: (event: CalendarEvent) => void;
  readonly onSwipeMonth?: (amount: -1 | 1) => void;
}

type OpenSheet = { date: string; eventKey?: string };

/** Each date owns its event controls; details state never writes the selected visit. */
export function ScheduleMonthGrid({
  days,
  eventsForDay,
  focusDate,
  focusedDate,
  todayDate,
  width,
  largeText,
  selectedEvent,
  selectionDisabled,
  selectEvent,
  onSwipeMonth,
}: ScheduleMonthGridProps) {
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const { density, responders } = useScheduleMonthGesture(onSwipeMonth);
  const expanded = (gridWidth || width) >= 700 || largeText;
  const maxVisible = expanded ? 3 : density >= 3 ? 2 : 1;
  // Scale layout dimensions, not the entire grid or text; Dynamic Type remains in control.
  const barHeight = largeText
    ? 44 + density * 2
    : (expanded ? 28 : 22) + density * 3;
  const cellSpacing = {
    minHeight: 48 + density * 12,
    paddingBottom: 3 + density,
  };
  const eventTarget = { minHeight: barHeight };
  const sheetEvents = sheet ? eventsForDay(sheet.date) : [];
  const sheetEvent = sheetEvents.find(item => item.rowKey === sheet?.eventKey);
  const isSelected = (item: CalendarMonthDisplayEvent) =>
    selectedEvent
      ? calendarEventsEqual(selectedEvent, item.event)
      : item.isNextVisit;
  const close = () => setSheet(null);

  return (
    <>
      {!largeText ? <CalendarWeekdayHeader flat /> : null}
      <View
        {...responders}
        style={largeText ? undefined : calendarStyles.calendarGrid}
        onLayout={event => setGridWidth(event.nativeEvent.layout.width)}
        testID="calendar-date-grid"
      >
        {days.map(day => {
          const date = day.dateKey;
          const items = eventsForDay(date);
          // Surface the chosen occurrence even when many events share this date.
          const active = items.find(isSelected);
          const visible = (
            active && items.indexOf(active) >= maxVisible
              ? [active, ...items.filter(item => item !== active)]
              : items
          ).slice(0, maxVisible);
          const overflow = items.length - visible.length;
          return (
            <View
              key={date}
              style={[
                styles.cell,
                cellSpacing,
                largeText && styles.accessibleCell,
              ]}
              testID={`schedule-date-events-${date}`}
            >
              <CalendarDayCell
                flat
                fillCell
                hideEventMarkers
                fullDate={largeText}
                day={day}
                dayEvents={items}
                label={calendarDayAccessibilityLabel(
                  date,
                  items,
                  date === todayDate,
                )}
                onPress={focusDate}
                selected={date === focusedDate}
                today={date === todayDate}
              />
              {visible.map(item => {
                const title =
                  item.event.calendarEventSnapshot.title ||
                  t('calendar.eventNoTitle');
                const selected = isSelected(item);
                return (
                  <Pressable
                    key={item.rowKey}
                    accessibilityRole="button"
                    accessibilityLabel={`${title}, ${formatCalendarEventRange(item.event)}${item.isNextVisit ? ', ' + t('calendar.nextVisit') : ''}`}
                    accessibilityState={{ selected }}
                    onPress={() => setSheet({ date, eventKey: item.rowKey })}
                    style={[
                      styles.bar,
                      eventTarget,
                      selected
                        ? styles.selected
                        : item.isNextVisit
                          ? styles.saved
                          : styles.ordinary,
                    ]}
                    testID={`schedule-event-bar-${date}-${item.event.calendarEventIdentifier}`}
                  >
                    <Text
                      numberOfLines={largeText ? undefined : 1}
                      style={[styles.title, selected && styles.selectedText]}
                    >
                      {title}
                    </Text>
                    {expanded ? (
                      <Text
                        style={[styles.time, selected && styles.selectedText]}
                      >
                        {formatCalendarEventStart(item.event)}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
              {overflow > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${formatCalendarDate(date)}, ${t('calendar.additionalEvents', { count: overflow })}`}
                  onPress={() => setSheet({ date })}
                  style={[styles.more, eventTarget]}
                  testID="schedule-date-event-overflow"
                >
                  <Text style={styles.time}>{`+${overflow}`}</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
      {sheet && sheetEvents.length > 0 ? (
        <ScheduleEventSheet
          date={sheet.date}
          event={sheetEvent}
          items={sheetEvents}
          isSelected={isSelected}
          draftActive={selectedEvent !== null}
          selectionDisabled={selectionDisabled}
          close={close}
          open={eventKey => setSheet({ date: sheet.date, eventKey })}
          select={event => {
            close();
            selectEvent(event);
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  cell: {
    width: '14.2857142857%',
    paddingHorizontal: 1,
    minWidth: 0,
    gap: 2,
    borderBottomColor: appColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  accessibleCell: { width: '100%', paddingHorizontal: 8, paddingBottom: 10 },
  bar: {
    minWidth: 0,
    justifyContent: 'center',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  ordinary: { backgroundColor: appColors.primarySoft },
  saved: { backgroundColor: appColors.greenSoft },
  selected: { backgroundColor: appColors.primaryAction },
  title: { color: appColors.primaryText, fontSize: 11, fontWeight: '600' },
  time: { color: appColors.secondary, fontSize: 10 },
  selectedText: { color: appColors.onPrimary },
  more: { alignItems: 'center', justifyContent: 'center' },
});
