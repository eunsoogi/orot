import { useState } from 'react';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { designTokens } from '../design';
import type { CalendarStyleSet } from './calendarStyles';

const minimumDateWidth = designTokens.minTouchTarget * 7;

/** Bound percentage columns before Yoga measures the horizontal scroll content. */
export function CalendarDateRegion({
  children,
  styles,
}: {
  children: ReactNode;
  styles: CalendarStyleSet;
}) {
  const [width, setWidth] = useState(minimumDateWidth);
  return (
    <ScrollView
      horizontal
      testID="calendar-date-viewport"
      contentContainerStyle={styles.calendarScrollContent}
      onLayout={event =>
        setWidth(Math.max(minimumDateWidth, event.nativeEvent.layout.width))
      }
    >
      <View
        style={[styles.calendarDates, { width }]}
        testID="calendar-date-content"
      >
        {children}
      </View>
    </ScrollView>
  );
}
