import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { appColors, appColorPalettes } from '../../layout/appColors';
import { OverviewNextVisitCard } from '../OverviewNextVisitCard';
import { OverviewMetrics } from './OverviewMetrics';
import { useOverviewMetrics } from './useOverviewMetrics';

jest.mock('./useOverviewMetrics');
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => false,
}));

test('keeps compact section separation independent of widget card spacing', async () => {
  jest.mocked(useOverviewMetrics).mockReturnValue({
    selection: ['sleep', 'heartRate'],
    metrics: {},
    quantityTruncated: false,
    state: 'ready',
    retry: jest.fn(),
    save: jest.fn(),
  });
  await render(
    <View>
      <OverviewNextVisitCard
        appointment={null}
        appointmentState="ready"
        onOpenSchedule={jest.fn()}
        onPrepareVisit={jest.fn()}
        onRetryAppointments={jest.fn()}
      />
      <OverviewMetrics />
    </View>,
  );

  const overview = screen.getByTestId('overview-health-overview-section');
  const changes = screen.getByTestId('overview-recent-changes-section');
  const health = screen.getByTestId('overview-health-sections');
  expect(health.children.indexOf(changes)).toBeLessThan(
    health.children.indexOf(overview),
  );
  expect(within(overview).getByText('내 건강 한눈에')).toBeTruthy();
  const grid = within(overview).getByTestId('overview-metric-grid');
  const ambient = within(overview).getByTestId('overview-widget-ambient', {
    includeHiddenElements: true,
  });
  expect(StyleSheet.flatten(grid.props.style)).toMatchObject({
    columnGap: 12,
    rowGap: 14,
  });
  for (const id of ['overview-metric-sleep', 'overview-heart-panel']) {
    const card = StyleSheet.flatten(within(grid).getByTestId(id).props.style);
    expect(card.backgroundColor).toEqual(appColors.overviewWidgetSurface);
    expect(card.opacity).toBeUndefined();
  }
  for (const palette of Object.values(appColorPalettes)) {
    expect(palette.overviewWidgetSurface).toBe(`${palette.surface}e8`);
  }
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
  ).toBe(16);
  const headingStyles = [
    'overview-health-overview-heading',
    'overview-recent-changes-heading',
  ].map(id => StyleSheet.flatten(screen.getByTestId(id).props.style));
  expect(headingStyles[0]).toEqual(headingStyles[1]);
  expect(headingStyles[0].minHeight).toBe(44);
  const sectionHeadingColor = (id: string) =>
    StyleSheet.flatten(screen.getByTestId(id).props.style).color;
  expect(sectionHeadingColor('overview-next-visit-heading')).toEqual(
    sectionHeadingColor('overview-recent-changes'),
  );
});
