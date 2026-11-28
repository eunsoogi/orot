import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { t } from '../../i18n';
import { AppState, NativeModules } from 'react-native';
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

test('retains app preferences while reconciling actual OS notification access', async () => {
  const before = NativeModules.ReplyNotificationModule;
  const read = jest.fn().mockResolvedValue({ enabled: true, preview: false });
  const authorized = jest
    .fn()
    .mockResolvedValueOnce(true)
    .mockResolvedValue(false);
  const save = jest.fn();
  NativeModules.ReplyNotificationModule = { read, authorized, save };
  let changed: Parameters<typeof AppState.addEventListener>[1] | undefined;
  const app = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, cb) => {
      changed = cb;
      return { remove: jest.fn() };
    });
  try {
    const view = await render(<SettingsReplyNotificationSection />);
    expect(authorized).toHaveBeenCalledTimes(1);
    await act(async () => {
      changed?.('inactive');
      changed?.('background');
      changed?.('active');
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t('settings.replyNotification.denied'),
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(authorized).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
    await view.unmount();
  } finally {
    app.mockRestore();
    NativeModules.ReplyNotificationModule = before;
  }
});
