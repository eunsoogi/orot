import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';
import { OverviewMetricSelectionEditor } from './OverviewMetricSelectionEditor';
import { overviewMetricTitle } from './OverviewMetricCard';

test('presents choices as full-row checkboxes with selected and unselected status', async () => {
  await render(
    <OverviewMetricSelectionEditor
      canSave
      onCancel={jest.fn()}
      onMove={jest.fn()}
      onSave={jest.fn()}
      onToggle={jest.fn()}
      saving={false}
      saveError={false}
      selection={['sleep', 'heartRate']}
      title={overviewMetricTitle}
    />,
  );

  expect(
    StyleSheet.flatten(
      screen.getByTestId('overview-metric-selection-editor').props.style,
    ),
  ).toMatchObject({
    borderWidth: 0,
    paddingHorizontal: 16,
    paddingVertical: 12,
  });
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
  ).toMatchObject({ minHeight: 48, borderWidth: 0 });
  expect(
    StyleSheet.flatten(
      screen.getByTestId('overview-metric-selection-save').props.style,
    ),
  ).toMatchObject({ minHeight: 48, backgroundColor: appColors.primaryAction });
});

test('offers accessible moves only for selected metrics, bounded to the current order', async () => {
  const onMove = jest.fn();
  await render(
    <OverviewMetricSelectionEditor
      canSave
      onCancel={jest.fn()}
      onMove={onMove}
      onSave={jest.fn()}
      onToggle={jest.fn()}
      saving={false}
      saveError={false}
      selection={['heartRate', 'sleep']}
      title={overviewMetricTitle}
    />,
  );
  const first = screen.getByRole('adjustable', { name: '심박수 순서 변경' });
  expect(first.props.accessibilityValue.text).toBe('1 / 2');
  expect(first.props.accessibilityActions).toEqual([
    { name: 'increment', label: '아래로 이동' },
  ]);
  expect(StyleSheet.flatten(first.props.style)).toMatchObject({
    width: 44,
    minHeight: 44,
  });
  expect(screen.queryByTestId('overview-metric-reorder-steps')).toBeNull();
  await fireEvent(first, 'accessibilityAction', {
    nativeEvent: { actionName: 'decrement' },
  });
  expect(onMove).not.toHaveBeenCalled();
  await fireEvent(first, 'accessibilityAction', {
    nativeEvent: { actionName: 'increment' },
  });
  expect(onMove).toHaveBeenCalledWith('heartRate', 1);
});
