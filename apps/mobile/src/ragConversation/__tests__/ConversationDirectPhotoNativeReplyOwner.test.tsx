import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { directPhotoComposerFixture } from '../testSupport/directPhotoComposerFixture';

jest.mock('../conversationDirectPhotoPorts', () => ({
  conversationDirectPhotoPorts: {
    hasPicker: jest.fn(() => true),
    pick: jest.fn(),
    authorization: jest.fn(),
    grant: jest.fn(),
  },
}));

test('only the completed native photo request owns the exact durable reply', async () => {
  const f = await directPhotoComposerFixture({ hold: true });
  const view = await render(f.view);
  try {
    const send = async () => {
      await fireEvent.press(screen.getByRole('button', { name: '사진 첨부' }));
      await fireEvent.press(screen.getByTestId('rag-conversation-send'));
    };
    await send();
    await waitFor(() => expect(f.start).toHaveBeenCalledTimes(1));
    const first = f.requestId();
    expect(first).toMatch(/^photo-reply:[0-9a-f]{32}$/);
    expect(
      f.session().currentDisplayMessages?.find(row => row.deliveryPending)
        ?.directPhotoTurnId,
    ).toBe(first);
    await fireEvent.press(screen.getByTestId('rag-conversation-cancel'));
    await waitFor(() => expect(f.cancel).toHaveBeenCalledWith(first));

    await send();
    await waitFor(() => expect(f.start).toHaveBeenCalledTimes(2));
    const second = f.requestId();
    expect(second).not.toBe(first);
    await act(() => f.completePhoto(first));
    expect(screen.queryByText('합성 이미지 설명')).toBeNull();
    expect(
      f.session().currentDisplayMessages?.find(row => row.deliveryPending)
        ?.directPhotoTurnId,
    ).toBe(second);

    await act(() => f.completePhoto(second));
    await screen.findByText('합성 이미지 설명');
    const cold = f.createOptions();
    const page = await cold.readSavedHistoryDisplay?.(
      'selected',
      0,
      new AbortController().signal,
    );
    expect(page?.rows).toEqual([
      expect.objectContaining({
        id: second,
        answer: '합성 이미지 설명',
        directPhoto: true,
      }),
    ]);
    expect(f.session().messages).toEqual([]);
    expect(f.ordinary).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    f.close();
  }
});
