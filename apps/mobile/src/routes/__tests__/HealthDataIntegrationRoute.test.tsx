import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useNavigationLeaveStateRegistration } from '../../navigation';
import { HealthDataIntegrationRoute } from '../HealthDataIntegrationRoute';

const availableIntegrationStatus = {
  availability: 'available' as const,
  lastSync: null,
  statusLoadFailed: false,
};

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));
jest.mock('../../navigation/useNavigationContentInset', () => ({
  useNavigationContentInset: () => [],
  useNavigationOcclusion: () => {
    const zeroInsets = { top: 0, right: 0, bottom: 0, left: 0 };
    return {
      placement: 'bottom',
      systemInsets: zeroInsets,
      viewportInsets: zeroInsets,
      scrollContentInsets: zeroInsets,
    };
  },
}));

test('saves compact automatic-sync choices and shows the result', async () => {
  const loadSelection = jest.fn(
    async () => ['medications', 'bloodPressure'] as const,
  );
  const loadIntegrationStatus = jest
    .fn()
    .mockResolvedValueOnce(availableIntegrationStatus)
    .mockResolvedValueOnce({
      ...availableIntegrationStatus,
      lastSync: {
        status: 'complete' as const,
        updatedAt: '2026-10-27T00:00:00.000Z',
      },
    });
  let finishSave:
    ((result: { readonly status: 'complete' }) => void) | undefined;
  const saveSelection = jest.fn(
    () =>
      new Promise<{ readonly status: 'complete' }>(resolve => {
        finishSave = resolve;
      }),
  );
  await render(
    <HealthDataIntegrationRoute
      loadIntegrationStatus={loadIntegrationStatus}
      loadSelection={loadSelection}
      saveSelection={saveSelection}
    />,
  );

  const medications = await screen.findByTestId(
    'health-data-feature-medications',
  );
  const bloodPressure = screen.getByTestId('health-data-feature-bloodPressure');
  const sleep = screen.getByTestId('health-data-feature-sleep');
  expect(medications.props.accessibilityState.checked).toBe(true);
  expect(bloodPressure.props.accessibilityState.checked).toBe(true);
  expect(sleep.props.accessibilityState.checked).toBe(false);
  expect(
    screen.getByTestId('health-data-feature-status-sleep'),
  ).toHaveTextContent('자동 동기화 꺼짐');
  expect(screen.getByTestId('health-data-connection-status')).toHaveTextContent(
    '이 기기에서 HealthKit을 사용할 수 있어요.',
  );
  expect(screen.getByTestId('health-data-permission-status')).toHaveTextContent(
    /HealthKit 읽기 허용 여부는 앱에서 확인할 수 없어요\./,
  );

  await fireEvent.press(bloodPressure);
  await fireEvent.press(sleep);
  await fireEvent.press(screen.getByTestId('health-data-save'));

  expect(saveSelection).toHaveBeenCalledWith(['medications', 'sleep']);
  expect(screen.getByTestId('health-data-save')).toHaveTextContent(
    '설정 저장 중…',
  );
  expect(
    screen.getByTestId('health-data-save').props.accessibilityState,
  ).toEqual(expect.objectContaining({ busy: true, disabled: true }));
  await act(async () => finishSave?.({ status: 'complete' }));
  expect(await screen.findByTestId('health-data-status')).toHaveTextContent(
    '자동 동기화 설정을 저장했어요.',
  );
  expect(
    await screen.findByText('마지막 동기화에서 선택한 기록을 확인했어요.'),
  ).toBeTruthy();
  expect(loadIntegrationStatus).toHaveBeenCalledTimes(2);
});

test('keeps an unsaved selection visible when preference persistence fails', async () => {
  const loadSelection = jest.fn(async () => [] as const);
  const loadIntegrationStatus = jest.fn(async () => availableIntegrationStatus);
  const saveSelection = jest.fn(async () => ({
    status: 'selection_save_failed' as const,
  }));
  await render(
    <HealthDataIntegrationRoute
      loadIntegrationStatus={loadIntegrationStatus}
      loadSelection={loadSelection}
      saveSelection={saveSelection}
    />,
  );

  const medications = await screen.findByTestId(
    'health-data-feature-medications',
  );
  await fireEvent.press(medications);
  await fireEvent.press(screen.getByTestId('health-data-save'));

  expect(await screen.findByTestId('health-data-status')).toHaveTextContent(
    '선택한 자동 동기화 설정을 저장하지 못했어요. 다시 시도해 주세요.',
  );
  expect(medications.props.accessibilityState.checked).toBe(true);
  expect(
    jest.mocked(useNavigationLeaveStateRegistration).mock.calls.at(-1)?.[0],
  ).toMatchObject({ hasUnsavedChanges: true });
});

test('retries the saved choices without hiding the permission limitation', async () => {
  const loadSelection = jest
    .fn()
    .mockRejectedValueOnce(new Error('Encrypted settings unavailable'))
    .mockResolvedValueOnce(['sleep'] as const);
  const loadIntegrationStatus = jest.fn(async () => availableIntegrationStatus);

  await render(
    <HealthDataIntegrationRoute
      loadIntegrationStatus={loadIntegrationStatus}
      loadSelection={loadSelection}
    />,
  );

  expect(await screen.findByTestId('health-data-load-error')).toBeTruthy();
  await screen.findByTestId('health-data-connection-status');
  expect(
    screen.getByTestId('health-data-save').props.accessibilityState,
  ).toEqual(expect.objectContaining({ disabled: true }));
  const statusLoadCalls = loadIntegrationStatus.mock.calls.length;
  await fireEvent.press(screen.getByTestId('health-data-load-retry'));

  const sleep = await screen.findByTestId('health-data-feature-sleep');
  expect(sleep.props.accessibilityState.checked).toBe(true);
  expect(loadSelection).toHaveBeenCalledTimes(2);
  expect(loadIntegrationStatus).toHaveBeenCalledTimes(statusLoadCalls);
  expect(screen.getByTestId('health-data-permission-status')).toHaveTextContent(
    /HealthKit 읽기 허용 여부는 앱에서 확인할 수 없어요\./,
  );
});

test('retries HealthKit status without replacing unsaved category choices', async () => {
  const loadSelection = jest.fn(async () => ['steps'] as const);
  let finishRetry:
    ((status: typeof availableIntegrationStatus) => void) | undefined;
  const pendingStatus = new Promise<typeof availableIntegrationStatus>(
    resolve => {
      finishRetry = resolve;
    },
  );
  const loadIntegrationStatus = jest
    .fn()
    .mockRejectedValueOnce(new Error('HealthKit status unavailable'))
    .mockReturnValueOnce(pendingStatus);
  const saveSelection = jest.fn(async () => ({ status: 'complete' as const }));

  await render(
    <HealthDataIntegrationRoute
      loadIntegrationStatus={loadIntegrationStatus}
      loadSelection={loadSelection}
      saveSelection={saveSelection}
    />,
  );

  const steps = await screen.findByTestId('health-data-feature-steps');
  expect(steps.props.accessibilityState.disabled).toBe(false);
  expect(screen.getByTestId('health-data-connection-status')).toHaveTextContent(
    'HealthKit 연결 상태를 확인하지 못했어요.',
  );
  expect(screen.getByTestId('health-data-status-load-error')).toHaveTextContent(
    '연동 상태를 모두 확인하지 못했어요.',
  );
  await fireEvent.press(screen.getByTestId('health-data-feature-heartRate'));
  expect(
    screen.getByTestId('health-data-feature-status-heartRate'),
  ).toHaveTextContent('자동 동기화 켜짐');
  await fireEvent.press(screen.getByTestId('health-data-status-retry'));
  expect(screen.getByTestId('health-data-connection-status')).toHaveTextContent(
    '연동 상태를 확인하는 중…',
  );
  await act(async () => finishRetry?.(availableIntegrationStatus));
  expect(
    await screen.findByTestId('health-data-connection-status'),
  ).toHaveTextContent('이 기기에서 HealthKit을 사용할 수 있어요.');
  expect(
    screen.getByTestId('health-data-feature-status-heartRate'),
  ).toHaveTextContent('자동 동기화 켜짐');
  expect(loadSelection).toHaveBeenCalledTimes(1);
  expect(saveSelection).not.toHaveBeenCalled();
});
