import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { ConversationScreen } from '../ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import type { ConversationSessions } from '../conversationSessions';
import { medicalDocumentImportService } from '../../medicalDocuments/medicalDocumentImportService';

jest.mock('../../medicalDocuments/medicalDocumentImportService', () => ({
  medicalDocumentImportService: {
    selectDocument: jest.fn().mockResolvedValue({
      id: 'synthetic',
      displayName: 'synthetic.jpg',
      contentHash: `sha256:${'a'.repeat(64)}`,
      previewData: 'data:image/jpeg;base64,c3ludGhldGlj',
      sections: [
        { id: 'span', text: 'synthetic', startOffset: 0, endOffset: 9 },
      ],
    }),
    discardDocument: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../ConversationSavedRecaps', () => ({
  ConversationSavedRecaps: () => null,
}));

test('the real screen selects without sending and keeps its photo with its session', async () => {
  let store!: ConversationSessions;
  const onSend = jest.fn();
  function Screen() {
    store = useConversationSessions();
    return (
      <ConversationScreen
        onBack={() => {}}
        onOpenSource={() => {}}
        onSend={onSend}
      />
    );
  }
  const view = await render(
    <ConversationSessionsProvider>
      <Screen />
    </ConversationSessionsProvider>,
  );
  const first = store.getSnapshot().activeId;
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '합성 질문',
  );
  await fireEvent.press(screen.getByRole('button', { name: '사진 첨부' }));
  await waitFor(() =>
    expect(screen.getByTestId('conversation-photo-preview')).toBeTruthy(),
  );
  expect(medicalDocumentImportService.selectDocument).toHaveBeenCalledWith(
    'photos',
  );
  expect(onSend).not.toHaveBeenCalled();
  expect(screen.getByTestId('rag-conversation-send').props.disabled).toBe(true);
  await act(() => store.create());
  expect(screen.queryByTestId('conversation-photo-preview')).toBeNull();
  await act(() => store.select(first));
  expect(screen.getByTestId('conversation-photo-preview')).toBeTruthy();
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
    '합성 질문',
  );
  await view.unmount();
});

test('the other session enables its picker when a pending picker is cancelled', async () => {
  let finish!: (value: null) => void;
  jest
    .mocked(medicalDocumentImportService.selectDocument)
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
  let store!: ConversationSessions;
  function Screen() {
    store = useConversationSessions();
    return (
      <ConversationScreen
        onBack={() => {}}
        onOpenSource={() => {}}
        onSend={jest.fn()}
      />
    );
  }
  const view = await render(
    <ConversationSessionsProvider>
      <Screen />
    </ConversationSessionsProvider>,
  );
  await fireEvent.press(screen.getByRole('button', { name: '사진 첨부' }));
  await act(() => store.create());
  expect(screen.getByRole('button', { name: '사진 첨부' })).toBeDisabled();
  await act(async () => {
    finish(null);
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '사진 첨부' })).toBeEnabled(),
  );
  await view.unmount();
});

test('a photo remains available for undo and is retired when that undo is replaced', async () => {
  let store!: ConversationSessions;
  function Screen() {
    store = useConversationSessions();
    return (
      <ConversationScreen
        onBack={() => {}}
        onOpenSource={() => {}}
        onSend={jest.fn()}
      />
    );
  }
  const view = await render(
    <ConversationSessionsProvider>
      <Screen />
    </ConversationSessionsProvider>,
  );
  const first = store.getSnapshot().activeId;
  await fireEvent.press(screen.getByRole('button', { name: '사진 첨부' }));
  await waitFor(() =>
    expect(screen.getByTestId('conversation-photo-preview')).toBeTruthy(),
  );
  const discard = jest.mocked(medicalDocumentImportService.discardDocument);
  discard.mockClear();
  await act(() => store.remove(first));
  expect(discard).not.toHaveBeenCalled();
  const second = store.getSnapshot().activeId;
  await act(() => store.remove(second));
  await waitFor(() => expect(discard).toHaveBeenCalledTimes(1));
  await view.unmount();
});

test('a picker result arriving after session finalization is retired', async () => {
  let finish!: (
    value: Awaited<
      ReturnType<typeof medicalDocumentImportService.selectDocument>
    >,
  ) => void;
  jest
    .mocked(medicalDocumentImportService.selectDocument)
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
  let store!: ConversationSessions;
  function Screen() {
    store = useConversationSessions();
    return (
      <ConversationScreen
        onBack={() => {}}
        onOpenSource={() => {}}
        onSend={jest.fn()}
      />
    );
  }
  const view = await render(
    <ConversationSessionsProvider>
      <Screen />
    </ConversationSessionsProvider>,
  );
  const first = store.getSnapshot().activeId;
  const discard = jest.mocked(medicalDocumentImportService.discardDocument);
  discard.mockClear();
  await fireEvent.press(screen.getByRole('button', { name: '사진 첨부' }));
  await act(() => store.remove(first));
  await act(() => store.remove(store.getSnapshot().activeId));
  await act(async () => {
    finish({
      id: 'late',
      displayName: 'late.jpg',
      contentHash: `sha256:${'a'.repeat(64)}`,
      sections: [],
    });
  });
  await waitFor(() =>
    expect(discard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'late' }),
    ),
  );
  await view.unmount();
});
