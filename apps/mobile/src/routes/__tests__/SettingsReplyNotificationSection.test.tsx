import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { t } from '../../i18n';
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
  const risk = t('settings.replyNotification.previewRisk');
  expect(screen.getByText(risk)).toBeTruthy();
  expect(
    screen.queryByText(t('settings.replyNotification.description')),
  ).toBeNull();
  const enabled = await screen.findByLabelText('답변 알림 받기');
  await waitFor(() =>
    expect(enabled.props.accessibilityState.disabled).toBe(false),
  );
  expect(enabled.props.accessibilityHint).toBe(risk);
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

test('keeps a blocked permission status visible without saving or prompting', async () => {
  const save = jest.fn();
  NativeModules.ReplyNotificationModule = {
    read: jest.fn().mockResolvedValue({ enabled: true, preview: false }),
    authorized: jest.fn().mockResolvedValue(false),
    save,
  };
  await render(<SettingsReplyNotificationSection />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    t('settings.replyNotification.denied'),
  );
  expect(save).not.toHaveBeenCalled();
});
