import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useNavigationLeaveStateRegistration } from '../../navigation';
import { HealthDataIntegrationRoute } from '../HealthDataIntegrationRoute';

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
  expect(screen.queryByTestId('health-data-connection-status')).toBeNull();
  expect(screen.queryByTestId('health-data-last-sync-status')).toBeNull();

  await fireEvent.press(bloodPressure);
  await fireEvent.press(sleep);
  await fireEvent.press(screen.getByTestId('health-data-save'));

  expect(saveSelection).toHaveBeenCalledWith(
    ['medications', 'sleep'],
    expect.any(Function),
  );
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
});

test('keeps an unsaved selection visible when preference persistence fails', async () => {
  const loadSelection = jest.fn(async () => [] as const);
  const saveSelection = jest.fn(async () => ({
    status: 'selection_save_failed' as const,
  }));
  await render(
    <HealthDataIntegrationRoute
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

test('retries the saved choices without leaving the health data screen', async () => {
  const loadSelection = jest
    .fn()
    .mockRejectedValueOnce(new Error('Encrypted settings unavailable'))
    .mockResolvedValueOnce(['sleep'] as const);

  await render(<HealthDataIntegrationRoute loadSelection={loadSelection} />);

  expect(await screen.findByTestId('health-data-load-error')).toBeTruthy();
  expect(
    screen.getByTestId('health-data-save').props.accessibilityState,
  ).toEqual(expect.objectContaining({ disabled: true }));
  await fireEvent.press(screen.getByTestId('health-data-load-retry'));

  const sleep = await screen.findByTestId('health-data-feature-sleep');
  expect(sleep.props.accessibilityState.checked).toBe(true);
  expect(loadSelection).toHaveBeenCalledTimes(2);
  expect(screen.queryByTestId('health-data-permission-status')).toBeNull();
});
