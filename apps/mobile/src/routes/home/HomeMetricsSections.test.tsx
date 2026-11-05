import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { HomeMetrics } from './HomeMetrics';
import { useHomeMetrics } from './useHomeMetrics';

jest.mock('./useHomeMetrics');

test('groups both Home sections with equal heading and content spacing', async () => {
  jest.mocked(useHomeMetrics).mockReturnValue({
    selection: ['sleep', 'heartRate'],
    metrics: {},
    quantityTruncated: false,
    state: 'ready',
    retry: jest.fn(),
    save: jest.fn(),
  });
  await render(<HomeMetrics />);

  const overview = screen.getByTestId('home-health-overview-section');
  const changes = screen.getByTestId('home-recent-changes-section');
  expect(within(overview).getByText('내 건강 한눈에')).toBeTruthy();
  expect(within(overview).getByTestId('home-metric-grid')).toBeTruthy();
  expect(within(changes).getByText('최근 달라진 점')).toBeTruthy();
  expect(
    within(changes).getByText('비교할 기록이 충분하지 않아요.'),
  ).toBeTruthy();
  expect(StyleSheet.flatten(overview.props.style).gap).toBe(12);
  expect(StyleSheet.flatten(changes.props.style).gap).toBe(12);
  expect(
    StyleSheet.flatten(screen.getByTestId('home-health-sections').props.style)
      .gap,
  ).toBe(24);
  const headingStyles = [
    'home-health-overview-heading',
    'home-recent-changes-heading',
  ].map(id => StyleSheet.flatten(screen.getByTestId(id).props.style));
  expect(headingStyles[0]).toEqual(headingStyles[1]);
  expect(headingStyles[0].minHeight).toBe(44);
});
