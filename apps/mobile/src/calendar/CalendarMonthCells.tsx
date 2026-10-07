import { Pressable, View } from 'react-native';
import { t } from '../i18n';
import { DesignButton, DesignCard, DesignIcon, DesignText } from '../design';
import { calendarGridTextScaleLimit } from './calendarStyles';
import type { CalendarStyleSet } from './calendarStyles';
import { formatCalendarEventRange } from './dateTime';
import type { CalendarGridDay } from './calendarMonth';
import { formatCalendarDate } from './calendarMonth';
import type { CalendarMonthDisplayEvent } from './calendarMonthEvents';
import type { CalendarEvent } from './types';

export function calendarDayAccessibilityLabel(
  dateKey: string,
  dayEvents: CalendarMonthDisplayEvent[],
): string {
  const visit = dayEvents.some(item => item.isNextVisit)
    ? [t('calendar.nextVisit')]
    : [];
  const titles = dayEvents
    .slice(0, 3)
    .map(
      item =>
        item.event.calendarEventSnapshot.title || t('calendar.eventNoTitle'),
    );
  return [formatCalendarDate(dateKey), ...visit, ...titles].join(', ');
}

interface CalendarDayCellProps {
  day: CalendarGridDay;
  dayEvents: CalendarMonthDisplayEvent[];
  label: string;
  selected: boolean;
  onPress: (dateKey: string) => void;
  styles: CalendarStyleSet;
}

export function CalendarDayCell({
  day,
  dayEvents,
  label,
  onPress,
  selected,
  styles,
}: CalendarDayCellProps) {
  const hasNextVisit = dayEvents.some(item => item.isNextVisit);
  // Keep the date as one screen-reader stop; its button label summarizes these visual marks.
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onPress(day.dateKey)}
      style={[
        styles.calendarDay,
        !day.belongsToMonth && styles.calendarOutsideDay,
        selected && styles.calendarSelectedDay,
      ]}
      testID={`calendar-day-${day.dateKey}`}
    >
      <DesignText
        maxFontSizeMultiplier={calendarGridTextScaleLimit}
        testID={`calendar-day-number-${day.dateKey}`}
        tone={
          selected ? 'accent' : day.belongsToMonth ? 'primary' : 'secondary'
        }
        variant="caption"
      >
        {day.dayNumber}
      </DesignText>
      {dayEvents.length ? (
        <DesignText
          accessibilityElementsHidden
          importantForAccessibility="no"
          maxFontSizeMultiplier={calendarGridTextScaleLimit}
          style={styles.calendarEventCount}
          testID={`calendar-day-event-count-${day.dateKey}`}
          tone="accent"
          variant="small"
        >
          {dayEvents.length}
        </DesignText>
      ) : null}
      {hasNextVisit ? (
        <DesignIcon
          name="next-visit"
          testID={`calendar-day-next-visit-${day.dateKey}`}
          tone="warning"
          size={designIconSize}
        />
      ) : null}
    </Pressable>
  );
}

interface CalendarMonthEventRowProps {
  item: CalendarMonthDisplayEvent;
  onSelectEvent: (event: CalendarEvent) => void;
  styles: CalendarStyleSet;
}

export function CalendarMonthEventRow({
  item,
  onSelectEvent,
  styles,
}: CalendarMonthEventRowProps) {
  const title =
    item.event.calendarEventSnapshot.title || t('calendar.eventNoTitle');
  const time = formatCalendarEventRange(item.event);

  return (
    <DesignCard
      style={[
        styles.calendarEventRow,
        item.isNextVisit && styles.calendarNextVisitEvent,
      ]}
      testID={item.isNextVisit ? 'calendar-next-visit' : undefined}
    >
      <View
        style={styles.calendarEventHeading}
        testID={`calendar-event-row-${item.rowKey}`}
      >
        <DesignText
          testID={item.isNextVisit ? 'calendar-next-visit-title' : undefined}
          variant="bodyStrong"
        >
          {title}
        </DesignText>
        {item.isNextVisit ? (
          <DesignText
            style={styles.calendarNextVisitBadge}
            tone="warning"
            variant="small"
          >
            {t('calendar.nextVisit')}
          </DesignText>
        ) : null}
      </View>
      <DesignText
        testID={item.isNextVisit ? 'calendar-next-visit-time' : undefined}
        tone="secondary"
        variant="caption"
      >
        {time}
      </DesignText>
      {item.canSelect ? (
        <DesignButton
          accessibilityLabel={`${title}, ${time}, ${t('calendar.selectEvent')}`}
          label={t('calendar.selectEvent')}
          onPress={() => onSelectEvent(item.event)}
          style={styles.calendarSelectEventButton}
          testID={`calendar-candidate-${item.event.calendarEventIdentifier}`}
          variant="secondary"
        />
      ) : null}
    </DesignCard>
  );
}

const designIconSize = 14;
