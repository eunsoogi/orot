import { fireEvent, render, screen } from '@testing-library/react-native';
import { t } from '../../i18n';
import { ConversationMessage } from '../ConversationMessage';
import type { DisplayMessage } from '../conversationDisplayMessage';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test('an owned outgoing photo can zoom; retired or restored markers never open images', async () => {
  const message: DisplayMessage = {
    id: 1,
    role: 'user',
    content: '',
    photoAttached: true,
  };
  const uri = 'data:image/jpeg;base64,c3ludGhldGlj';
  const row = (previewURI?: string) => (
    <ConversationMessage
      message={{ ...message, directPhotoPreviewData: previewURI }}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />
  );
  const view = await render(row(uri));
  expect(
    screen.getByTestId('conversation-sent-photo-image').props.source,
  ).toEqual({ uri });
  expect(screen.queryByText(t('ragConversation.photo.message'))).toBeNull();
  const open = () =>
    fireEvent.press(screen.getByTestId('conversation-sent-photo-open'));
  await open();
  expect(
    screen.getByTestId('conversation-photo-viewer-image').props.source,
  ).toEqual({ uri });
  expect(
    screen.getByTestId('conversation-photo-viewer-zoom').props.maximumZoomScale,
  ).toBe(4);
  await fireEvent.press(screen.getByRole('button', { name: '사진 닫기' }));
  expect(screen.queryByTestId('conversation-photo-viewer')).toBeNull();
  await open();
  await view.rerender(row());
  expect(screen.queryByTestId('conversation-photo-viewer')).toBeNull();
  expect(screen.queryByTestId('conversation-sent-photo-open')).toBeNull();
  expect(screen.getByText(t('ragConversation.photo.message'))).toBeTruthy();
});
