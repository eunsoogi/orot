import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { openLocalStorage } from '../../storage/secureDatabase';
import { OverviewMetricSelectionEditor } from './OverviewMetricSelectionEditor';
import { overviewMetricTitle } from './OverviewMetricCard';
import { OverviewMetrics } from './OverviewMetrics';
import { useOverviewMetrics } from './useOverviewMetrics';
import {
  isOverviewSnapshotMetric,
  loadOverviewMetricSelection,
  saveOverviewMetricSelection,
  type OverviewMetricChoice,
} from './metricSelection';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));
jest.mock('./useOverviewMetrics');
jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
}));

test('keeps workout association separate in the editor, saved order, and actual Overview grid', async () => {
  const lane = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(lane.database);
    const repository = createRecordRepository(lane.database);
    const selected: OverviewMetricChoice[] = [
      'sleep',
      'restingHeartRate',
      'workoutHeartRate',
      'walkingHeartRate',
    ];
    let moved: OverviewMetricChoice[] | null = null;
    const editor = await render(
      <OverviewMetricSelectionEditor
        canSave
        onCancel={jest.fn()}
        onMove={(metric, index) => {
          moved = selected.filter(item => item !== metric);
          moved.splice(index, 0, metric);
        }}
        onSave={jest.fn()}
        onToggle={jest.fn()}
        saving={false}
        saveError={false}
        selection={selected}
        title={overviewMetricTitle}
      />,
    );
    expect(screen.getByRole('checkbox', { name: '운동 심박수' })).toBeChecked();
    await fireEvent(
      screen.getByRole('adjustable', { name: '운동 심박수 순서 변경' }),
      'accessibilityAction',
      { nativeEvent: { actionName: 'decrement' } },
    );
    expect(moved).toEqual([
      'sleep',
      'workoutHeartRate',
      'restingHeartRate',
      'walkingHeartRate',
    ]);
    expect(openLocalStorage).not.toHaveBeenCalled();
    await editor.unmount();

    await saveOverviewMetricSelection(repository, moved!);
    const persisted = await loadOverviewMetricSelection(repository);
    expect(persisted).toEqual(moved);
    expect(persisted.filter(isOverviewSnapshotMetric)).toEqual([
      'sleep',
      'restingHeartRate',
      'walkingHeartRate',
    ]);
    jest.mocked(useOverviewMetrics).mockReturnValue({
      selection: persisted,
      metrics: {},
      quantityTruncated: false,
      state: 'ready',
      retry: jest.fn(),
      save: jest.fn(),
    });
    const grid = await render(<OverviewMetrics />);
    const c = screen.getByTestId('overview-metric-workoutHeartRate');
    expect(
      within(c).getByRole('button', { name: '운동 선택하기' }),
    ).toBeEnabled();
    expect(
      screen.queryByTestId('overview-metric-chart-workoutHeartRate'),
    ).toBeNull();
    expect(openLocalStorage).not.toHaveBeenCalled();
    await grid.unmount();
  } finally {
    lane.close();
  }
});
