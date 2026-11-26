import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { ConversationScreen } from '../ConversationScreen';
import type { ConversationScreenProps } from '../ConversationScreenProps';

const mockStartVoice = jest.fn();
const mockPickImage = jest.fn();

jest.mock('../useConversationDirectPhoto', () => {
  const { createConversationPhotoConsentController } = jest.requireActual<
    typeof import('../conversationPhotoConsentController')
  >('../conversationPhotoConsentController');
  const groupReview = createConversationPhotoConsentController();
  return {
    useConversationDirectPhoto: () => ({
      available: true,
      state: {},
      pick: mockPickImage,
      groupReview,
    }),
  };
});

jest.mock('../../voiceConversation/ConversationVoiceEntry', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    ConversationVoiceEntry: () =>
      React.createElement(Pressable, {
        accessibilityRole: 'button',
        accessibilityLabel: 'Synthetic Live voice',
        onPress: mockStartVoice,
      }),
  };
});

test('the mounted composer no longer shows a saved recording picker', async () => {
  let signal: AbortSignal | undefined;
  const send = jest.fn<
    ReturnType<ConversationScreenProps['onSend']>,
    Parameters<ConversationScreenProps['onSend']>
  >((_text, _history, owner) => {
    signal = owner;
    return new Promise(resolve =>
      owner?.addEventListener('abort', () =>
        resolve({
          status: 'answer',
          answer: 'Synthetic result',
          citations: [],
        }),
      ),
    );
  });
  const view = await render(
    <ConversationScreen
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      onSend={send}
      voiceSelection={{ revision: 1, resolve: jest.fn() }}
    />,
  );
  expect(screen.queryByTestId('conversation-recording-choose')).toBeNull();
  expect(screen.queryByTestId('conversation-recording-selection')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: '사진 첨부' }));
  expect(mockPickImage).toHaveBeenCalledTimes(1);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Synthetic Live voice' }),
  );
  expect(mockStartVoice).toHaveBeenCalledTimes(1);
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'Synthetic message',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(send.mock.calls[0]?.[0]).toBe('Synthetic message');
  expect(send.mock.calls[0]?.[3]?.selectedRecordingTranscript).toBeUndefined();
  await fireEvent.press(screen.getByTestId('rag-conversation-cancel'));
  await waitFor(() => expect(signal?.aborted).toBe(true));
  await view.unmount();
});
