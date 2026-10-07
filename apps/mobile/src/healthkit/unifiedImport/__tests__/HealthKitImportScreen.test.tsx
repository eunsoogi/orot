import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { healthKitFeatures } from '../../types';
import { createUnifiedImportCoordinator } from '../coordinator';
import type { UnifiedFeatureStatus, UnifiedImportStatus } from '../types';
import {
  HealthKitImportScreen,
  type HealthKitImportScreenCopy,
} from '../HealthKitImportScreen';
import { createTestServices, deferred } from '../testSupport';

const copy: HealthKitImportScreenCopy = {
  title: '가져오기',
  description: '필요한 항목을 선택하세요.',
  localOnly: '선택한 기록은 이 기기에 저장됩니다.',
  readAuthorization: 'HealthKit 읽기 권한 상태는 확인할 수 없습니다.',
  importButton: '선택 항목 가져오기',
  cancelButton: '가져오기 취소',
  featureNames: Object.fromEntries(
    healthKitFeatures.map(feature => [feature, feature]),
  ) as HealthKitImportScreenCopy['featureNames'],
  featureStatuses: Object.fromEntries(
    [
      'notSelected',
      'waitingAuthorization',
      'ready',
      'querying',
      'persisting',
      'complete',
      'empty',
      'partial',
      'unsupportedFeature',
      'unsupportedPlatform',
      'unavailable',
      'unsupportedData',
      'notRun',
      'failed',
      'cancelled',
    ].map(status => [status, status]),
  ) as Record<UnifiedFeatureStatus, string>,
  phaseStatuses: Object.fromEntries(
    [
      'queued',
      'authorizingHealthKit',
      'preparingStorage',
      'querying',
      'cancelling',
      'complete',
      'empty',
      'partial',
      'failed',
      'cancelled',
    ].map(status => [status, status]),
  ) as Record<UnifiedImportStatus, string>,
  changeSummary: (imported, deleted) =>
    `${imported} imported / ${deleted} deleted`,
};

test('requires a selected type and shows HealthKit results from one action', async () => {
  const base = createTestServices();
  const coordinator = createUnifiedImportCoordinator(base.services);
  await render(<HealthKitImportScreen copy={copy} coordinator={coordinator} />);

  expect(screen.getByTestId('unified-import-start')).toBeDisabled();
  expect(
    screen.getByTestId('unified-import-read-authorization'),
  ).toHaveTextContent('HealthKit 읽기 권한 상태는 확인할 수 없습니다.');
  await fireEvent.press(screen.getByTestId('unified-import-toggle-heartRate'));
  await fireEvent.press(screen.getByTestId('unified-import-start'));

  expect(base.timeline).toContain('healthKit.authorization:heartRate');
  expect(await screen.findByTestId('unified-import-status')).toHaveTextContent(
    'complete',
  );
  expect(
    screen.getByTestId('unified-import-toggle-heartRate'),
  ).toHaveTextContent(/complete/);
  expect(screen.getByText('1 imported / 0 deleted')).toBeTruthy();
});

test('offers HealthKit selections without a Calendar option', async () => {
  const base = createTestServices();
  const coordinator = createUnifiedImportCoordinator(base.services);
  await render(<HealthKitImportScreen copy={copy} coordinator={coordinator} />);

  for (const feature of healthKitFeatures) {
    expect(screen.getByTestId(`unified-import-toggle-${feature}`)).toBeTruthy();
  }
  expect(screen.queryByTestId('unified-import-toggle-calendar')).toBeNull();
});

test('prevents repeated taps, supports app-level cancellation, and retries with the same selection', async () => {
  const base = createTestServices();
  const authorization =
    deferred<
      Awaited<
        ReturnType<typeof base.services.healthKit.requestReadAuthorizations>
      >
    >();
  const healthKit = {
    requestReadAuthorizations: jest.fn(() => authorization.promise),
  };
  const coordinator = createUnifiedImportCoordinator({
    ...base.services,
    healthKit,
  });
  await render(<HealthKitImportScreen copy={copy} coordinator={coordinator} />);
  await fireEvent.press(screen.getByTestId('unified-import-toggle-steps'));
  await fireEvent.press(screen.getByTestId('unified-import-toggle-heartRate'));
  await fireEvent.press(screen.getByTestId('unified-import-start'));

  expect(healthKit.requestReadAuthorizations).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('unified-import-start')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('unified-import-cancel'));
  authorization.resolve({
    availability: 'available',
    requestStatus: 'completed',
    readAuthorization: 'notObservable',
    requestedFeatures: ['heartRate', 'steps'],
    unsupportedFeatures: [],
  });

  await waitFor(() =>
    expect(screen.getByTestId('unified-import-status')).toHaveTextContent(
      'cancelled',
    ),
  );
  expect(base.timeline).not.toContain('storage.open');
  await fireEvent.press(screen.getByTestId('unified-import-start'));
  expect(healthKit.requestReadAuthorizations).toHaveBeenCalledTimes(2);
});
