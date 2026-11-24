import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { ConversationScreen } from '../../../ragConversation/ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../../../ragConversation/ConversationSessionsContext';
import type { ConversationSessions } from '../../../ragConversation/conversationSessionTypes';
import { conversationDirectPhotoPorts as ports } from '../../../ragConversation/conversationDirectPhotoPorts';
import { directPhotoComposerFixture } from '../../../ragConversation/testSupport/directPhotoComposerFixture';
import { syntheticDirectJPEG } from '../testSupport/directPhotoSendFixture';

jest.mock('../../../ragConversation/conversationDirectPhotoPorts', () => ({
  conversationDirectPhotoPorts: {
    hasPicker: jest.fn(() => true),
    pick: jest.fn(),
    authorization: jest.fn(),
    grant: jest.fn(),
  },
}));
jest.mock('../../../ragConversation/ConversationSavedRecaps', () => ({
  ConversationSavedRecaps: () => null,
}));

const attach = () =>
  fireEvent.press(screen.getByRole('button', { name: '사진 첨부' }));
const send = () => fireEvent.press(screen.getByTestId('rag-conversation-send'));

test('the real screen holds image pixels until Settings consent and saves only its completed reply in the selected session', async () => {
  const fixture = await directPhotoComposerFixture();
  const options = fixture.createOptions();
  const ordinarySend = jest.fn();
  let store!: ConversationSessions;
  function Screen() {
    store = useConversationSessions();
    return (
      <ConversationScreen
        onBack={() => {}}
        onOpenSource={() => {}}
        onSend={ordinarySend}
      />
    );
  }
  try {
    const view = await render(
      <ConversationSessionsProvider options={options}>
        <Screen />
      </ConversationSessionsProvider>,
    );
    await act(() =>
      store.attachExisting('selected', 0, '2026-10-05T00:00:00.000Z'),
    );
    const first = store.getSnapshot().activeId;
    await fireEvent.changeText(
      screen.getByTestId('rag-conversation-input'),
      '합성 질문',
    );
    await attach();
    expect(screen.getByTestId('conversation-photo-preview')).toBeTruthy();
    expect(ports.grant).not.toHaveBeenCalled();
    expect(fixture.start).not.toHaveBeenCalled();

    // A session switch retires transient image pixels, but preserves authored text.
    await act(() => store.create());
    expect(screen.queryByTestId('conversation-photo-preview')).toBeNull();
    await act(() => store.select(first));
    expect(screen.queryByTestId('conversation-photo-preview')).toBeNull();
    expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
      '합성 질문',
    );
    await attach();

    let release!: (grant: Awaited<ReturnType<typeof ports.grant>>) => void;
    jest.mocked(ports.grant).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = resolve;
        }),
    );
    await send();
    await waitFor(() => expect(ports.grant).toHaveBeenCalledTimes(1));
    expect(fixture.start).not.toHaveBeenCalled();
    // The exact existing Settings grant can be denied without losing the preview.
    await act(() => release(null));
    expect(
      await screen.findByText(/사진 전송에 동의하지 않았거나/),
    ).toBeTruthy();
    expect(screen.getByTestId('conversation-photo-preview')).toBeTruthy();
    expect(fixture.start).not.toHaveBeenCalled();
    expect(ordinarySend).not.toHaveBeenCalled();

    await send();
    await waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(1));
    expect(fixture.start).toHaveBeenCalledWith(
      'image-request',
      'synthetic-owner',
      {
        model: 'gpt-6.2-sol',
        directPhoto: { text: '합성 질문', jpegBase64: syntheticDirectJPEG },
      },
    );
    expect(await screen.findByText('합성 이미지 설명')).toBeTruthy();
    expect(screen.queryByTestId('conversation-photo-preview')).toBeNull();
    expect(ordinarySend).not.toHaveBeenCalled();
    expect(fixture.ordinary).not.toHaveBeenCalled();
    expect(await fixture.storage.listTimeline('selected', 0)).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(
      store
        .getSnapshot()
        .sessions.find(session => session.id === first)
        ?.savedHistoryDisplay?.map(item => item.row),
    ).toEqual([
      expect.objectContaining({
        // Only the approved answer and photo marker are saved, not the typed prompt.
        question: '',
        answer: '합성 이미지 설명',
        directPhoto: true,
      }),
    ]);
    await view.unmount();
  } finally {
    fixture.close();
  }
});
