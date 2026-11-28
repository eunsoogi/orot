import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import {
  NavigationContentFrameContext,
  type NavigationContentFrame,
} from '../../navigation/navigationContentFrame';
import { NavigationRouteScrollView } from '../../navigation/NavigationRouteScrollView';
import { OverviewMetrics } from './OverviewMetrics';
import { useOverviewMetrics } from './useOverviewMetrics';

jest.mock('./useOverviewMetrics');
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => false,
}));

const windowFrame = { x: 0, y: 0, width: 466, height: 678 };
const railFrame: NavigationContentFrame = {
  side: 'right',
  windowFrame,
  viewportFrame: windowFrame,
  availableContentFrame: { ...windowFrame, width: 382 },
  reservedRegions: [],
  navigationFrame: { x: 406, y: 174, width: 48, height: 270 },
};

test.each([
  ['expanded right rail', railFrame, 104],
  ['ordinary bottom tabs', { ...railFrame, side: 'bottom' as const }, 18],
  [
    'clipped split pane',
    { ...railFrame, viewportFrame: { ...windowFrame, width: 430 } },
    18,
  ],
] as const)(
  'only lends the widget background the available scroll lane for %s',
  async (_surface, frame, bleed) => {
    jest.mocked(useOverviewMetrics).mockReturnValue({
      selection: ['sleep', 'steps'],
      metrics: {},
      quantityTruncated: false,
      state: 'ready',
      retry: jest.fn(),
      save: jest.fn(),
    });
    const edit = jest.fn();
    await render(
      <NavigationContentFrameContext.Provider value={frame}>
        <NavigationRouteScrollView>
          <OverviewMetrics onEdit={edit} />
        </NavigationRouteScrollView>
      </NavigationContentFrameContext.Provider>,
    );

    const grid = screen.getByTestId('overview-metric-grid');
    await fireEvent(grid, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 342, height: 600 } },
    });
    const widgetSection = screen.getByTestId(
      'overview-health-overview-section',
    );
    const ambient = within(widgetSection).getByTestId(
      'overview-widget-ambient',
      {
        includeHiddenElements: true,
      },
    );
    expect(StyleSheet.flatten(ambient.props.style).right).toBe(-bleed);
    expect(widgetSection.children.indexOf(ambient)).toBeLessThan(
      widgetSection.children.indexOf(
        screen.getByTestId('overview-health-overview-heading'),
      ),
    );
    expect(ambient.props.pointerEvents).toBe('none');
    expect(ambient.props.accessibilityElementsHidden).toBe(true);
    expect(
      StyleSheet.flatten(
        screen.getByTestId('overview-metric-sleep').props.style,
      ).width,
    ).toBe(342);
    expect(
      within(
        screen.getByTestId('overview-recent-changes-section'),
      ).queryByTestId('overview-widget-ambient', {
        includeHiddenElements: true,
      }),
    ).toBeNull();
    await fireEvent.press(screen.getByTestId('overview-metrics-edit'));
    expect(edit).toHaveBeenCalledTimes(1);
  },
);
