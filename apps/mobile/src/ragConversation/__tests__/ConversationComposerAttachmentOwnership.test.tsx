import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationRecordingComposer } from '../ConversationRecordingComposer';
import { conversationDirectPhotoPorts as ports } from '../conversationDirectPhotoPorts';
import {
  directPhotoComposerFixture,
  onPickOCR,
} from '../testSupport/directPhotoComposerFixture';

jest.mock('../conversationDirectPhotoPorts', () => ({
  conversationDirectPhotoPorts: {
    hasPicker: jest.fn(() => true),
    pick: jest.fn(),
    authorization: jest.fn(),
    grant: jest.fn(),
  },
}));

jest.mock('../useConversationRecordingAttachment', () => {
  const { useState } = jest.requireActual<typeof React>('react');
  const row = {
    kind: 'audio_recording',
    key: 'fixture-recording',
    id: 'fixture-recording',
    title: 'Synthetic recording',
    createdAt: '2026-02-01T00:00:00.000Z',
  };
  return {
    useConversationRecordingAttachment: () => {
      const [open, setOpen] = useState(false);
      const [selected, setSelected] = useState<typeof row | null>(null);
      return {
        enabled: true,
        open,
        selected,
        page: { rows: [row], loading: false, failed: false, more: false },
        openPicker: () => setOpen(true),
        close: () => setOpen(false),
        pick: async () => {
          setOpen(false);
          setSelected(row);
        },
        clear: () => setSelected(null),
        dispatch: jest.fn(() => false),
      };
    },
  };
});

test('only one attachment owns the composer and removing it restores other actions', async () => {
  const fixture = await directPhotoComposerFixture();
  const send = jest.fn();
  const recording = () => screen.getByTestId('conversation-recording-choose');
  const photo = () => screen.getByRole('button', { name: '사진 첨부' });
  const textOnly = () =>
    screen.queryByRole('button', { name: '텍스트만 읽어 첨부' });
  try {
    await render(
      <ConversationRecordingComposer
        store={fixture.store}
        session={fixture.session()}
        ordinaryEntry
        photo={{ status: 'empty', onSelect: onPickOCR, onRemove: jest.fn() }}
        onChangeText={jest.fn()}
        send={send}
      />,
    );
    expect(recording()).toBeEnabled();
    await fireEvent.press(photo());
    expect(screen.getByTestId('conversation-photo-preview')).toBeTruthy();
    expect(recording()).toBeDisabled();
    await fireEvent.press(recording());
    expect(screen.queryByTestId('conversation-recording-options')).toBeNull();
    await fireEvent.press(
      screen.getByRole('button', { name: '첨부 사진 제거' }),
    );
    expect(recording()).toBeEnabled();
    await fireEvent.press(recording());
    expect(photo()).toBeDisabled();
    await fireEvent.press(
      screen.getByRole('button', { name: /^Synthetic recording/ }),
    );
    expect(screen.getByTestId('conversation-recording-selection')).toBeTruthy();
    expect(photo()).toBeDisabled();
    expect(textOnly()).toBeNull();
    await fireEvent.press(photo());
    expect(ports.pick).toHaveBeenCalledTimes(1);
    expect(onPickOCR).not.toHaveBeenCalled();
    await fireEvent.press(
      screen.getByRole('button', { name: '선택한 녹음 제거' }),
    );
    expect(photo()).toBeEnabled();
    expect(textOnly()).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
    expect(ports.grant).not.toHaveBeenCalled();
    expect(fixture.start).not.toHaveBeenCalled();
  } finally {
    fixture.close();
  }
});
