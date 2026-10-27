import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import { InferenceConsentSettings } from '../InferenceConsentSettings';
import { resetInferenceConsentReceipts } from '../../../storage/inferenceConsentStorage';

jest.mock('../../../storage/inferenceConsentStorage', () => ({
  resetInferenceConsentReceipts: jest.fn(),
}));

afterEach(() => {
  // Native Alert callbacks belong to one test scenario and must not leak into the next.
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

test('asks before revocation and allows retry when receipt deletion fails', async () => {
  const reset = jest.mocked(resetInferenceConsentReceipts);
  const alert = jest.spyOn(Alert, 'alert');
  reset
    .mockRejectedValueOnce(new Error('Synthetic write failure'))
    .mockResolvedValueOnce(undefined);
  await render(<InferenceConsentSettings />);
  await fireEvent.press(screen.getByTestId('inference-consent-clear'));
  expect(alert).toHaveBeenCalledTimes(1);
  expect(reset).not.toHaveBeenCalled();
  expect(alert.mock.calls[0]?.[0]).toBe('외부 전송 동의 내역을 지울까요?');
  expect(alert.mock.calls[0]?.[1]).toContain(
    '진료 기록이나 다른 앱 자료는 삭제되지 않아요.',
  );

  await fireEvent.press(screen.getByTestId('inference-consent-clear'));
  const cancelAction = alert.mock.calls[1]?.[2]?.[0];
  cancelAction?.onPress?.();
  expect(reset).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('inference-consent-clear'));
  const confirmAction = alert.mock.calls[2]?.[2]?.[1];
  await act(async () => {
    confirmAction?.onPress?.();
  });
  await waitFor(() =>
    expect(screen.getByText(/자동 재사용은 중단했어요/u)).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId('inference-consent-clear'));
  await act(async () => {
    alert.mock.calls[3]?.[2]?.[1]?.onPress?.();
  });
  await waitFor(() =>
    expect(screen.getByText(/동의 내역을 지웠어요/u)).toBeTruthy(),
  );
  expect(reset).toHaveBeenCalledTimes(2);
});

test('disables the clear action and reports progress until revocation settles', async () => {
  const reset = jest.mocked(resetInferenceConsentReceipts);
  const alert = jest.spyOn(Alert, 'alert');
  const onClearingChange = jest.fn();
  let finishClear: (() => void) | undefined;
  reset.mockReturnValue(
    new Promise<void>(resolve => {
      finishClear = resolve;
    }),
  );
  await render(
    <InferenceConsentSettings onClearingChange={onClearingChange} />,
  );

  await fireEvent.press(screen.getByTestId('inference-consent-clear'));
  await act(async () => {
    alert.mock.calls[0]?.[2]?.[1]?.onPress?.();
  });

  expect(
    screen.getByTestId('inference-consent-clear').props.accessibilityState
      ?.disabled,
  ).toBe(true);
  expect(screen.getByTestId('inference-consent-clearing')).toBeTruthy();
  expect(onClearingChange).toHaveBeenNthCalledWith(1, true);
  await fireEvent.press(screen.getByTestId('inference-consent-clear'));
  expect(alert).toHaveBeenCalledTimes(1);

  await act(async () => finishClear?.());
  await waitFor(() =>
    expect(screen.getByText(/동의 내역을 지웠어요/u)).toBeTruthy(),
  );
  expect(onClearingChange).toHaveBeenNthCalledWith(2, false);
});
