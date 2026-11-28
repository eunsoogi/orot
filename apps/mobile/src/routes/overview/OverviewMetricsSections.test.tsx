import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { OverviewMetrics } from './OverviewMetrics';
import { useOverviewMetrics } from './useOverviewMetrics';

jest.mock('./useOverviewMetrics');
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => false,
}));

test('groups both Home sections with equal heading and content spacing', async () => {
  jest.mocked(useOverviewMetrics).mockReturnValue({
    selection: ['sleep', 'heartRate'],
    metrics: {},
    quantityTruncated: false,
    state: 'ready',
    retry: jest.fn(),
    save: jest.fn(),
  });
  await render(<OverviewMetrics />);

  const overview = screen.getByTestId('overview-health-overview-section');
  const changes = screen.getByTestId('overview-recent-changes-section');
  const health = screen.getByTestId('overview-health-sections');
  expect(health.children.indexOf(changes)).toBeLessThan(
    health.children.indexOf(overview),
  );
  expect(within(overview).getByText('내 건강 한눈에')).toBeTruthy();
  const grid = within(overview).getByTestId('overview-metric-grid');
  const ambient = within(grid).getByTestId('overview-widget-ambient', {
    includeHiddenElements: true,
  });
  expect(ambient.props.pointerEvents).toBe('none');
  expect(ambient.props.accessibilityElementsHidden).toBe(true);
  expect(within(changes).getByText('최근 달라진 점')).toBeTruthy();
  expect(
    within(changes).getByText('비교할 기록이 충분하지 않아요.'),
  ).toBeTruthy();
  expect(StyleSheet.flatten(overview.props.style).gap).toBe(12);
  expect(StyleSheet.flatten(changes.props.style).gap).toBe(12);
  expect(
    StyleSheet.flatten(
      screen.getByTestId('overview-health-sections').props.style,
    ).gap,
  ).toBe(24);
  const headingStyles = [
    'overview-health-overview-heading',
    'overview-recent-changes-heading',
  ].map(id => StyleSheet.flatten(screen.getByTestId(id).props.style));
  expect(headingStyles[0]).toEqual(headingStyles[1]);
  expect(headingStyles[0].minHeight).toBe(44);
});
