import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import {
  NavigationContentFrameContext,
  type NavigationContentFrame,
} from '../../navigation/navigationContentFrame';
import { NavigationOcclusionContext } from '../../navigation/useNavigationContentInset';
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

it.each(['right', 'bottom'] as const)(
  'uses shared %s clearance once without a calendar-only viewport offset',
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
            scrollContentInsets: { ...zero, bottom: Math.max(overlap, 34) },
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
    ).toBe(Math.max(overlap, 34) + 16);
    expect(
      StyleSheet.flatten(scroll.parent!.props.style).marginBottom,
    ).toBeUndefined();
  },
);
