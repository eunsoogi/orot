import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';
import { OverviewMetrics } from './OverviewMetrics';
import { useOverviewMetrics } from './useOverviewMetrics';

jest.mock('./useOverviewMetrics');
const mocked = jest.mocked(useOverviewMetrics);

test('presents choices as full-row checkboxes with selected and unselected status', async () => {
  mocked.mockReturnValue({
    selection: ['sleep', 'heartRate'],
    metrics: {},
    quantityTruncated: false,
    state: 'ready',
    retry: jest.fn(),
    save: jest.fn(),
  });
  await render(<OverviewMetrics />);
  await fireEvent.press(screen.getByRole('button', { name: '편집' }));

  const selected = screen.getByRole('checkbox', { name: /기록된 수면/ });
  const unselected = screen.getByRole('checkbox', { name: /체중/ });
  expect(selected.props.accessibilityState.checked).toBe(true);
  expect(unselected.props.accessibilityState.checked).toBe(false);
  expect(
    screen.getByTestId('overview-metric-selection-status-sleep'),
  ).toHaveTextContent('한눈에 표시');
  expect(
    screen.getByTestId('overview-metric-selection-status-bodyMass'),
  ).toHaveTextContent('표시 안 함');
  expect(StyleSheet.flatten(selected.props.style)).toMatchObject({
    alignSelf: 'stretch',
    flexDirection: 'row',
    minHeight: 68,
  });
  expect(
    StyleSheet.flatten(
      screen.getByTestId('overview-metric-selection-actions').props.style,
    ),
  ).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
  expect(
    StyleSheet.flatten(
      screen.getByTestId('overview-metric-selection-cancel-slot').props.style,
    ),
  ).toMatchObject({ flexBasis: 140, flexGrow: 1, minWidth: 128 });
  expect(
    StyleSheet.flatten(
      screen.getByTestId('overview-metric-selection-save-slot').props.style,
    ),
  ).toMatchObject({ flexBasis: 140, flexGrow: 1, minWidth: 128 });
  expect(
    StyleSheet.flatten(
      screen.getByTestId('overview-metric-selection-cancel').props.style,
    ),
  ).toMatchObject({ minHeight: 48, borderWidth: 1 });
  expect(
    StyleSheet.flatten(
      screen.getByTestId('overview-metric-selection-save').props.style,
    ),
  ).toMatchObject({ minHeight: 48, backgroundColor: appColors.primaryAction });
});

test('explains the two-to-four selection limit and disables save below two choices', async () => {
  mocked.mockReturnValue({
    selection: ['sleep', 'heartRate'],
    metrics: {},
    quantityTruncated: false,
    state: 'ready',
    retry: jest.fn(),
    save: jest.fn(),
  });
  await render(<OverviewMetrics />);
  await fireEvent.press(screen.getByRole('button', { name: '편집' }));

  expect(screen.getByText('지표를 2개에서 4개 선택하세요.')).toBeTruthy();
  const save = screen.getByRole('button', { name: '저장' });
  expect(save).toBeEnabled();
  await fireEvent.press(screen.getByRole('checkbox', { name: /기록된 수면/ }));
  expect(save).toBeDisabled();
  await fireEvent.press(screen.getByRole('checkbox', { name: /기록된 수면/ }));
  await fireEvent.press(screen.getByRole('checkbox', { name: /체중/ }));
  await fireEvent.press(
    screen.getByRole('checkbox', { name: /기록된 걸음 샘플 합계/ }),
  );
  expect(save).toBeEnabled();
});
