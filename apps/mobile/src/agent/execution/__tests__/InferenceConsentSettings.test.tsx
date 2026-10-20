import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { InferenceConsentSettings } from '../InferenceConsentSettings';
import { resetInferenceConsentReceipts } from '../../../storage/inferenceConsentStorage';

jest.mock('../../../storage/inferenceConsentStorage', () => ({
  resetInferenceConsentReceipts: jest.fn(),
}));

test('reports successful revocation and allows retry when deletion fails', async () => {
  const reset = jest.mocked(resetInferenceConsentReceipts);
  reset
    .mockRejectedValueOnce(new Error('Synthetic write failure'))
    .mockResolvedValueOnce(undefined);
  await render(<InferenceConsentSettings />);
  await fireEvent.press(screen.getByTestId('inference-consent-clear'));
  await waitFor(() =>
    expect(screen.getByText(/자동 재사용은 중단했어요/u)).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId('inference-consent-clear'));
  await waitFor(() =>
    expect(screen.getByText(/동의 내역을 지웠어요/u)).toBeTruthy(),
  );
  expect(reset).toHaveBeenCalledTimes(2);
});
