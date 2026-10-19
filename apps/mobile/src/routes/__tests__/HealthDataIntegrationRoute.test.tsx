import { fireEvent, render, screen } from '@testing-library/react-native';
import { useNavigationLeaveStateRegistration } from '../../navigation';
import { HealthDataIntegrationRoute } from '../HealthDataIntegrationRoute';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));
jest.mock('../../navigation/useNavigationContentInset', () => ({
  useNavigationContentInset: () => [],
}));

test('saves compact automatic-sync choices and shows the result', async () => {
  const loadSelection = jest.fn(
    async () => ['medications', 'bloodPressure'] as const,
  );
  const saveSelection = jest.fn(async () => ({ status: 'complete' as const }));
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

  await fireEvent.press(bloodPressure);
  await fireEvent.press(sleep);
  await fireEvent.press(screen.getByTestId('health-data-save'));

  expect(saveSelection).toHaveBeenCalledWith(['medications', 'sleep']);
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
