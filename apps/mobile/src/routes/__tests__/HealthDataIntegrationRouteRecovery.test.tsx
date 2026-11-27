import { fireEvent, render, screen } from '@testing-library/react-native';
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

test('shows sanitized recovery guidance and leaves the request retryable', async () => {
  const saveSelection = jest.fn(async () => ({
    status: 'retryable' as const,
    authorizationFailure: {
      stage: 'presentation' as const,
      code: 'presentationUnavailable' as const,
    },
  }));

  await render(
    <HealthDataIntegrationRoute
      loadSelection={jest.fn(async () => ['medications'] as const)}
      saveSelection={saveSelection}
    />,
  );

  await screen.findByTestId('health-data-feature-medications');
  await fireEvent.press(screen.getByTestId('health-data-save'));

  expect(
    await screen.findByTestId('health-data-authorization-failure'),
  ).toHaveTextContent(
    '복약 권한 화면을 열지 못했어요. 열린 시스템 화면을 닫은 뒤 다시 저장해 주세요.',
  );
  expect(
    screen.getByTestId('health-data-authorization-diagnostic'),
  ).toHaveTextContent('확인 단계: 권한 화면 표시, 결과: 권한 화면을 열지 못함');
  expect(
    screen.getByTestId('health-data-authorization-diagnostic'),
  ).not.toHaveTextContent(/presentation|Unavailable/u);
  expect(
    screen.getByTestId('health-data-save').props.accessibilityState.disabled,
  ).toBe(false);
});
