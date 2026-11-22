import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';
import { OverviewMetricSelectionEditor } from './OverviewMetricSelectionEditor';
import { overviewMetricTitle } from './OverviewMetricCard';

test('presents choices as full-row checkboxes with selected and unselected status', async () => {
  await render(
    <OverviewMetricSelectionEditor
      canSave
      onCancel={jest.fn()}
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
