import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import {
  NavigationContentFrameContext,
  type NavigationContentFrame,
} from '../../navigation/navigationContentFrame';
import { NavigationOcclusionContext } from '../../navigation/useNavigationContentInset';
import { calendarScrollEdge } from '../calendarScrollEdge';
import CalendarLinkingScreen from '../CalendarLinkingScreen';
import { bridge, repository } from '../calendarLinkingTestFixtures';

const frame: NavigationContentFrame = {
  windowFrame: { x: 0, y: 0, width: 951, height: 669 },
  viewportFrame: { x: 0, y: 0, width: 951, height: 669 },
  availableContentFrame: { x: 0, y: 0, width: 867, height: 635 },
  side: 'right',
  navigationFrame: null,
  reservedRegions: [],
};

it('reclaims only the measured bottom edge and leaves keyboard and standalone bounds alone', () => {
  expect(calendarScrollEdge(frame, true)).toBe(34);
  expect(calendarScrollEdge(frame, false)).toBe(0);
  expect(calendarScrollEdge(null, true)).toBe(0);
  expect(
    calendarScrollEdge(
      {
        ...frame,
        viewportFrame: { ...frame.viewportFrame, height: 420 },
        availableContentFrame: { ...frame.availableContentFrame, height: 420 },
      },
      true,
    ),
  ).toBe(0);
});

it.each(['right', 'bottom'] as const)(
  'moves the edge into scroll-end clearance without losing %s navigation overlap',
  async placement => {
    const overlap = placement === 'bottom' ? 60 : 0;
    const zero = { top: 0, left: 0, right: 0, bottom: 0 };
    const screen = await render(
      <NavigationContentFrameContext.Provider
        value={{ ...frame, side: placement }}
      >
        <NavigationOcclusionContext.Provider
          value={{
            placement,
            systemInsets: { ...zero, bottom: 34 },
            viewportInsets: { ...zero, bottom: 34 },
            scrollContentInsets: { ...zero, bottom: overlap },
          }}
        >
          <CalendarLinkingScreen
            adaptiveScheduleLayout
            bridge={bridge()}
            repository={repository(async () => [])}
          />
        </NavigationOcclusionContext.Provider>
      </NavigationContentFrameContext.Provider>,
    );
    const scroll = screen.getByTestId('calendar-screen');
    expect(
      StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom,
    ).toBe(overlap + 16 + 34);
    expect(StyleSheet.flatten(scroll.parent!.props.style).marginBottom).toBe(
      -34,
    );
  },
);
