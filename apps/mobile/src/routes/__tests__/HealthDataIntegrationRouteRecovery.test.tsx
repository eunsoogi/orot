import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppState } from 'react-native';
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
      loadIntegrationStatus={jest.fn(async () => availableIntegrationStatus)}
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
  ).toHaveTextContent(
    '요청 단계: presentation, 오류 코드: presentationUnavailable',
  );
  expect(
    screen.getByTestId('health-data-save').props.accessibilityState.disabled,
  ).toBe(false);
});

test('reloads saved sync status on return from Health without requesting access', async () => {
  let stateChangeHandler:
    Parameters<typeof AppState.addEventListener>[1] | undefined;
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((event, handler) => {
      if (event === 'change') stateChangeHandler = handler;
      return { remove: jest.fn() };
    });
  const loadIntegrationStatus = jest.fn(async () => availableIntegrationStatus);
  const saveSelection = jest.fn(async () => ({ status: 'complete' as const }));

  try {
    await render(
      <HealthDataIntegrationRoute
        loadIntegrationStatus={loadIntegrationStatus}
        loadSelection={jest.fn(async () => ['sleep'] as const)}
        saveSelection={saveSelection}
      />,
    );

    await screen.findByTestId('health-data-feature-sleep');
    const initialReads = loadIntegrationStatus.mock.calls.length;
    await act(async () => {
      stateChangeHandler?.('background');
      stateChangeHandler?.('active');
    });

    await waitFor(() =>
      expect(loadIntegrationStatus).toHaveBeenCalledTimes(initialReads + 1),
    );
    expect(saveSelection).not.toHaveBeenCalled();
    expect(screen.getByTestId('health-data-status')).toBeTruthy();
  } finally {
    subscription.mockRestore();
  }
});
