import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { navigationText } from '../i18n/navigation';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { NavigationModal } from '../navigation/NavigationModal';
import { ScheduleAgendaSelectAction } from './ScheduleAgendaSelectAction';
import { formatCalendarDate } from './calendarMonth';
import type { CalendarMonthDisplayEvent } from './calendarMonthEvents';
import { formatCalendarEventRange } from './dateTime';
import type { CalendarEvent } from './types';

interface ScheduleEventSheetProps {
  readonly date: string;
  readonly event?: CalendarMonthDisplayEvent;
  readonly items: readonly CalendarMonthDisplayEvent[];
  readonly isSelected: (item: CalendarMonthDisplayEvent) => boolean;
  readonly draftActive: boolean;
  readonly selectionDisabled: boolean;
  readonly close: () => void;
  readonly open: (key: string) => void;
  readonly select: (event: CalendarEvent) => void;
}
function titleFor(item: CalendarMonthDisplayEvent) {
  return item.event.calendarEventSnapshot.title || t('calendar.eventNoTitle');
}

/** The sheet previews current event data; only the explicit action starts the existing guarded draft. */
export function ScheduleEventSheet({
  date,
  event,
  items,
  isSelected,
  draftActive,
  selectionDisabled,
  close,
  open,
  select,
}: ScheduleEventSheetProps) {
  return (
    <NavigationModal
      visible
      presentationStyle="pageSheet"
      allowSwipeDismissal
      onRequestClose={close}
      testID="schedule-event-sheet"
    >
      <View
        style={styles.shell}
        accessibilityViewIsModal
        onAccessibilityEscape={close}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={navigationText.close.accessibilityLabel}
          style={styles.close}
          onPress={close}
          testID="schedule-event-sheet-close"
        >
          <View
            accessible={false}
            pointerEvents="none"
            style={styles.grabber}
          />
        </Pressable>
        <ScrollView contentContainerStyle={styles.content}>
          <Text accessibilityRole="header" style={styles.title}>
            {event ? titleFor(event) : formatCalendarDate(date)}
          </Text>
          {event ? (
            <>
              <Text testID="schedule-event-detail-time">
                {formatCalendarEventRange(event.event)}
              </Text>
              {event.isNextVisit ? (
                <Text>{t('calendar.nextVisit')}</Text>
              ) : null}
              {event.canSelect || event.isNextVisit ? (
                <ScheduleAgendaSelectAction
                  title={titleFor(event)}
                  time={formatCalendarEventRange(event.event)}
                  draftSelected={draftActive && isSelected(event)}
                  draftActive={draftActive}
                  savedVisit={event.isNextVisit}
                  disabled={selectionDisabled}
                  onPress={
                    event.canSelect ? () => select(event.event) : undefined
                  }
                  testID={
                    event.canSelect
                      ? `calendar-candidate-${event.event.calendarEventIdentifier}`
                      : 'schedule-saved-visit-selection'
                  }
                />
              ) : null}
            </>
          ) : (
            items.map(item => (
              <Pressable
                key={item.rowKey}
                accessibilityRole="button"
                accessibilityLabel={`${titleFor(item)}, ${formatCalendarEventRange(item.event)}`}
                accessibilityState={{ selected: isSelected(item) }}
                onPress={() => open(item.rowKey)}
                style={styles.item}
              >
                <Text style={styles.itemTitle}>{titleFor(item)}</Text>
                <Text>{formatCalendarEventRange(item.event)}</Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>
    </NavigationModal>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: appColors.background },
  close: {
    alignSelf: 'center',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: appColors.secondary,
  },
  content: { paddingHorizontal: 24, paddingBottom: 36, gap: 12 },
  title: { color: appColors.text, fontSize: 24, fontWeight: '700' },
  item: {
    minHeight: 44,
    paddingVertical: 8,
    borderBottomColor: appColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemTitle: { fontWeight: '600' },
});
