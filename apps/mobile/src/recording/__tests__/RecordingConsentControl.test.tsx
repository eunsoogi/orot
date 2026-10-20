import { render, screen } from '@testing-library/react-native';
import { RecordingConsentControl } from '../RecordingConsentControl';

test('makes acknowledged consent visibly distinct and exposes the same checked state', async () => {
  const view = await render(
    <RecordingConsentControl
      checked={false}
      disabled={false}
      onPress={jest.fn()}
    />,
  );
  expect(screen.getByRole('checkbox', { checked: false })).toBeTruthy();
  expect(screen.getByTestId('recording-consent-status')).toHaveTextContent(
    '동의 확인이 필요해요',
  );
  await view.rerender(
    <RecordingConsentControl checked disabled={false} onPress={jest.fn()} />,
  );
  expect(screen.getByRole('checkbox', { checked: true })).toBeTruthy();
  expect(screen.getByTestId('recording-consent-status')).toHaveTextContent(
    '동의 확인됨',
  );
});
