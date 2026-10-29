import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { HealthDataIntegrationScreen } from '../HealthDataIntegrationScreen';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation/useNavigationContentInset', () => ({
  useNavigationContentInset: () => ({ paddingBottom: 91 }),
  useNavigationOcclusion: () => {
    const zero = { top: 0, right: 0, bottom: 0, left: 0 };
    return { systemInsets: zero, viewportInsets: zero };
  },
}));

// One page includes every choice, recovery action, permission boundary and final action.
test('keeps all HealthData content and recovery controls in one vertical owner', async () => {
  const onRetryLoad = jest.fn();
  const onRetryStatus = jest.fn();
  const onSave = jest.fn();
  const onToggle = jest.fn();
  await render(
    <HealthDataIntegrationScreen
      integrationStatus={{
        availability: 'available',
        lastSync: { status: 'retryable', updatedAt: '2026-10-27T00:00:00Z' },
        statusLoadFailed: true,
      }}
      loadFailed
      loaded
      notice="selection_save_failed"
      onRetryLoad={onRetryLoad}
      onRetryStatus={onRetryStatus}
      onSave={onSave}
      onToggle={onToggle}
      saving={false}
      selected={new Set(['sleep'])}
      statusLoadFailed
    />,
  );

  expect(
    screen.container.queryAll(
      node => node.type === 'RCTScrollView' && node.props.horizontal !== true,
    ),
  ).toHaveLength(1);
  const page = screen.getByTestId('health-data-scroll');
  const content = within(page);
  expect(StyleSheet.flatten(page.props.contentContainerStyle)).toMatchObject({
    paddingBottom: 91,
  });
  for (const feature of [
    'medications',
    'bloodPressure',
    'sleep',
    'heartRate',
    'steps',
    'bodyMass',
  ]) {
    expect(content.getByTestId(`health-data-feature-${feature}`)).toBeTruthy();
  }
  for (const identifier of [
    'title',
    'connection-status',
    'permission-status',
    'last-sync-status',
    'last-sync-time',
    'load-error',
    'status-load-error',
    'status',
  ]) {
    expect(content.getByTestId(`health-data-${identifier}`)).toBeTruthy();
  }
  await fireEvent.press(content.getByTestId('health-data-feature-heartRate'));
  await fireEvent.press(content.getByTestId('health-data-load-retry'));
  await fireEvent.press(content.getByTestId('health-data-status-retry'));
  await fireEvent.press(content.getByTestId('health-data-save'));
  expect(onToggle).toHaveBeenCalledWith('heartRate');
  expect(onRetryLoad).toHaveBeenCalledTimes(1);
  expect(onRetryStatus).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledTimes(1);
});
