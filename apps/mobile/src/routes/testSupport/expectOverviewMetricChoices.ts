import { screen } from '@testing-library/react-native';

/** Distinguish offered choices from the selected preference before Save. */
export function expectOverviewMetricChoices(selected: readonly string[]) {
  const unselected = [
    'sleep',
    'heartRate',
    'bodyMass',
    'steps',
    'workouts',
  ].filter(metric => !selected.includes(metric));
  const orderedIds = (checked: boolean) =>
    screen
      .queryAllByRole('checkbox', { checked })
      .map(choice => choice.props.testID);
  const ids = (metrics: readonly string[]) =>
    metrics.map(metric => 'overview-metric-selection-' + metric);
  expect(screen.getAllByRole('checkbox')).toHaveLength(
    selected.length + unselected.length,
  );
  expect(orderedIds(true)).toEqual(ids(selected));
  expect(orderedIds(false)).toEqual(ids(unselected));
}
