import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { APIPlatformLink } from '../APIPlatformLink';

// Mock the OS handoff: these assertions do not claim Safari runtime coverage.
beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());
it('opens only the official public HTTPS destination and permits retry', async () => {
  const open = jest
    .spyOn(Linking, 'openURL')
    .mockRejectedValueOnce(new Error('private native payload'))
    .mockResolvedValueOnce(undefined);
  const view = await render(<APIPlatformLink />);
  const link = view.getByRole('link');
  await fireEvent.press(link);
  await waitFor(() => expect(view.getByRole('alert')).toBeTruthy());
  expect(view.queryByText(/private native payload/)).toBeNull();
  await fireEvent.press(link);
  await waitFor(() => expect(view.queryByRole('alert')).toBeNull());
  expect(open.mock.calls).toEqual([
    ['https://platform.openai.com/api-keys'],
    ['https://platform.openai.com/api-keys'],
  ]);
  expect(view.getByText(/Safari를 기본 브라우저/)).toBeTruthy();
});
it('blocks repeated activation and tolerates completion after navigation away', async () => {
  let finish!: () => void;
  const open = jest.spyOn(Linking, 'openURL').mockImplementation(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  const view = await render(<APIPlatformLink />);
  await fireEvent.press(view.getByRole('link'));
  await fireEvent.press(view.getByRole('link'));
  expect(open).toHaveBeenCalledTimes(1);
  await view.unmount();
  await act(async () => finish());
  const next = await render(<APIPlatformLink />);
  expect(next.getByRole('link').props.accessibilityState.disabled).toBe(false);
});
