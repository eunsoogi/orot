import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { directPhotoComposerFixture } from '../testSupport/directPhotoComposerFixture';
import { Transcript } from '../testSupport/savedHistoryDisplayFixture';

jest.mock('../conversationDirectPhotoPorts', () => ({
  conversationDirectPhotoPorts: {
    hasPicker: jest.fn(() => true),
    pick: jest.fn(),
    authorization: jest.fn(),
    grant: jest.fn(),
  },
}));

const photoRows = () => screen.getAllByTestId('conversation-sent-photo-image');
async function sendPhoto() {
  await fireEvent.press(screen.getByRole('button', { name: '사진 첨부' }));
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
}

test('two sent images stay available until their mounted workspace is retired', async () => {
  const fixture = await directPhotoComposerFixture();
  const view = await render(fixture.view);
  try {
    await sendPhoto();
    await screen.findByText('합성 이미지 설명');
    expect(photoRows()).toHaveLength(1);
    await sendPhoto();
    await waitFor(() =>
      expect(screen.getAllByText('합성 이미지 설명')).toHaveLength(2),
    );
    expect(photoRows()).toHaveLength(2);
    expect(fixture.start).toHaveBeenCalledTimes(2);

    fixture.start.mockImplementationOnce(async () => {});
    await sendPhoto();
    await waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(3));
    expect(photoRows()).toHaveLength(3);
    await fireEvent.press(screen.getByTestId('rag-conversation-cancel'));
    await waitFor(() => expect(photoRows()).toHaveLength(2));
    expect(fixture.cancel).toHaveBeenCalledTimes(1);

    await view.rerender(<Transcript store={fixture.store} />);
    expect(screen.queryByTestId('conversation-sent-photo-image')).toBeNull();
    expect(screen.getAllByText('합성 이미지 설명')).toHaveLength(2);
    expect(fixture.session().messages).toEqual([]);
  } finally {
    await view.unmount();
    fixture.close();
  }
});
