import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import { SettingsReplyNotificationSection } from '../SettingsReplyNotificationSection';

test('explains sensitive previews before explicit opt-in and supports suppression', async () => {
  const save = jest.fn().mockResolvedValue('authorized');
  NativeModules.ReplyNotificationModule = {
    read: jest.fn().mockResolvedValue({ enabled: false, preview: true }),
    authorized: jest.fn().mockResolvedValue(true),
    save,
  };
  await render(<SettingsReplyNotificationSection />);
  expect(screen.getByText(/민감한 건강 내용/)).toBeTruthy();
  const enabled = await screen.findByLabelText('답변 알림 받기');
  await waitFor(() => expect(enabled.props.accessibilityState.disabled).toBe(false));
  await fireEvent.press(enabled);
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({ enabled: true, preview: true }),
  );
  const preview = screen.getByLabelText('알림에 답변 내용 표시');
  await fireEvent.press(preview);
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({ enabled: true, preview: false }),
  );
});
