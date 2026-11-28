import { fireEvent, render } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { CalendarMonthView } from '../CalendarMonthView';

jest.mock('../ScheduleMonthGrid', () => {
  const { Pressable, View } = jest.requireActual('react-native');
  return {
    ScheduleMonthGrid: ({
      onSwipeMonth,
    }: {
      onSwipeMonth: (amount: -1 | 1) => void;
    }) => (
      <View>
        <Pressable
          testID="simulate-next-swipe"
          onPress={() => onSwipeMonth(1)}
        />
        <Pressable
          testID="simulate-previous-swipe"
          onPress={() => onSwipeMonth(-1)}
        />
      </View>
    ),
  };
});

it.each([false, true])(
  'pages across a year boundary with Reduce Motion=%s',
  async reduceMotion => {
    const translation = jest.spyOn(Animated.Value.prototype, 'setValue');
    const timing = jest.spyOn(Animated, 'timing');
    try {
      const calendar = await render(
        <NavigationMotionContext.Provider value={reduceMotion}>
          <CalendarMonthView
            flat
            appointmentsLoading={false}
            candidatesLoaded={false}
            events={[]}
            initialDate={new Date(2035, 11, 31)}
            linkedAppointment={null}
            onSelectEvent={jest.fn()}
            queryWindow={null}
            resultsMayBeIncomplete={false}
          />
        </NavigationMotionContext.Provider>,
      );
      await fireEvent(
        calendar.getByTestId('navigation-inline-transition'),
        'layout',
        {
          nativeEvent: { layout: { width: 360, height: 320, x: 0, y: 0 } },
        },
      );
      await fireEvent.press(calendar.getByTestId('simulate-next-swipe'));
      expect(calendar.getByTestId('calendar-month-title')).toHaveTextContent(
        '2036년 1월',
      );
      await fireEvent.press(calendar.getByTestId('simulate-previous-swipe'));
      expect(calendar.getByTestId('calendar-month-title')).toHaveTextContent(
        '2035년 12월',
      );
      if (reduceMotion) {
        expect(timing).not.toHaveBeenCalled();
      } else {
        expect(translation).toHaveBeenCalledWith(360);
        expect(translation).toHaveBeenCalledWith(-360);
        expect(timing).toHaveBeenCalledTimes(2);
      }
    } finally {
      jest.restoreAllMocks();
    }
  },
);
