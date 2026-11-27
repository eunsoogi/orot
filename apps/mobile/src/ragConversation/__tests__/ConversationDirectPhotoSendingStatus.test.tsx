import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { t } from '../../i18n';
import { directPhotoComposerFixture } from '../testSupport/directPhotoComposerFixture';
import { conversationDirectPhotoPorts as ports } from '../conversationDirectPhotoPorts';

jest.mock('../conversationDirectPhotoPorts', () => ({
  conversationDirectPhotoPorts: {
    hasPicker: jest.fn(() => true),
    pick: jest.fn(),
    authorization: jest.fn(),
    grant: jest.fn(),
  },
}));

test('a mounted photo in flight does not report preparation failure when its preview moves to history', async () => {
  const f = await directPhotoComposerFixture({ hold: true });
  const view = await render(f.view);
  try {
    jest.mocked(ports.hasPicker).mockReturnValue(true);
    await act(() => f.store.setDraft(f.session().id, 'Synthetic caption'));
    await fireEvent.press(
      screen.getByRole('button', { name: t('ragConversation.photo.select') }),
    );
    expect(screen.getByTestId('conversation-photo-preview')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('rag-conversation-send'));
    await waitFor(() => expect(f.start).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('conversation-sent-photo-image')).toBeTruthy();
    expect(screen.getByText('Synthetic caption')).toBeTruthy();
    expect(screen.getByText(/전송 중/u)).toBeTruthy();
    expect(screen.queryByTestId('conversation-photo-preview')).toBeNull();
    expect(screen.queryByText(t('ragConversation.photo.error'))).toBeNull();
    expect(screen.getByTestId('rag-conversation-input').props.value).toBe('');
    expect(
      screen.queryByText(t('ragConversation.photo.transferring')),
    ).toBeNull();
    await fireEvent.changeText(
      screen.getByTestId('rag-conversation-input'),
      'New unsent caption',
    );
    expect(screen.getByText('Synthetic caption')).toBeTruthy();
    expect(f.cancel).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('rag-conversation-cancel'));
    await waitFor(() => expect(f.cancel).toHaveBeenCalledWith('image-request'));
    expect(screen.queryByText(/전송 중/u)).toBeNull();
    expect(
      screen.queryByText(t('ragConversation.photo.transferring')),
    ).toBeNull();
    expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
      'New unsent caption',
    );
    expect(f.ordinary).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    f.close();
  }
});
