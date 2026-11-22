import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { t } from '../../i18n';
import { syntheticDirectJPEG } from '../../aiFeatures/integration/testSupport/directPhotoSendFixture';
import { conversationHistoryPayload } from '../conversationHistoryPayload';
import {
  directPhotoComposerFixture,
  onPickOCR,
  onSendText,
} from '../testSupport/directPhotoComposerFixture';
import { conversationDirectPhotoPorts as ports } from '../conversationDirectPhotoPorts';

jest.mock('../conversationDirectPhotoPorts', () => ({
  conversationDirectPhotoPorts: {
    hasPicker: jest.fn(() => true),
    pick: jest.fn(),
    authorization: jest.fn(),
    grant: jest.fn(),
  },
}));

const attach = () =>
  fireEvent.press(screen.getByRole('button', { name: '사진 첨부' }));
const send = () => fireEvent.press(screen.getByTestId('rag-conversation-send'));
const databases: Array<() => void> = [];
async function fixture(
  options?: Parameters<typeof directPhotoComposerFixture>[0],
) {
  const f = await directPhotoComposerFixture(options);
  databases.push(f.close);
  return f;
}
beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  for (const close of databases.splice(0)) close();
});

test('an image without text traverses the attached composer and only the dedicated authorized transport', async () => {
  const f = await fixture();
  await render(f.view);
  await attach();
  expect(screen.getByTestId('conversation-photo-preview')).toBeTruthy();
  expect(f.start).not.toHaveBeenCalled();
  await send();
  expect(screen.queryByTestId('conversation-photo-consent')).toBeNull();
  expect(await screen.findByText('합성 이미지 설명')).toBeTruthy();
  expect(f.start).toHaveBeenCalledTimes(1);
  expect(f.start).toHaveBeenCalledWith('image-request', 'synthetic-owner', {
    model: 'gpt-6.2-sol',
    directPhoto: { text: '', jpegBase64: syntheticDirectJPEG },
  });
  expect(f.ordinary).not.toHaveBeenCalled();
  expect(onSendText).not.toHaveBeenCalled();
  expect(screen.getByText(t('ragConversation.photo.message'))).toBeTruthy();
  expect(f.session().messages).toEqual([]);
  expect(conversationHistoryPayload(f.session().messages, 'next')).toEqual([]);
  expect(await f.storage.listTimeline('selected', 0)).toEqual({
    items: [],
    nextCursor: null,
  });
  expect(f.session().savedHistoryDisplay?.map(item => item.row)).toEqual([
    expect.objectContaining({
      answer: '합성 이미지 설명',
      question: '',
      directPhoto: true,
    }),
  ]);
});

test('opted-in automatic memory excludes a direct photo and its authored preference', async () => {
  const f = await fixture({ enableOrdinaryMemory: true });
  expect(f.optedIn).toBe(true);
  const authored = 'For future replies, I prefer concise answers.';
  const sessionId = f.session().id;
  await render(f.view);
  await act(() => f.store.setDraft(sessionId, authored));
  await attach();
  await send();
  expect(await screen.findByText('합성 이미지 설명')).toBeTruthy();
  expect(f.start).toHaveBeenCalledWith('image-request', 'synthetic-owner', {
    model: 'gpt-6.2-sol',
    directPhoto: { text: authored, jpegBase64: syntheticDirectJPEG },
  });
  expect(f.memoryCapture).not.toHaveBeenCalled();
  expect(f.memorySave).not.toHaveBeenCalled();
  expect(await f.storage.listCompletionIdentities()).toEqual([]);

  await act(async () => {
    f.store.setDraft(sessionId, authored);
    await f.store.send(
      sessionId,
      async (question, history, signal, observer) => {
        expect(history).toEqual([]);
        const answer = 'Synthetic ordinary reply';
        await observer!.onRetentionCandidate!(
          {
            question,
            answer,
            modelId: 'synthetic',
            providerId: 'synthetic',
            proactiveMemory: true,
            sources: [],
            citations: [],
          },
          signal!,
        );
        return { status: 'answer', answer, citations: [] };
      },
    );
  });
  expect(f.memoryCapture).toHaveBeenCalledTimes(1);
  expect(f.memorySave).toHaveBeenCalledTimes(1);
  expect(await f.memorySave.mock.results[0]?.value).toBe(true);
});

test.each(['denied', 'retired', 'unsupported'])(
  '%s makes no transfer, while explicit OCR is still separate',
  async condition => {
    const f = await fixture({
      supported: condition !== 'unsupported',
      granted: condition !== 'denied',
      holdGrant: condition === 'retired',
    });
    await render(f.view);
    await attach();
    await send();
    if (condition === 'denied')
      expect(
        await screen.findByText(/사진 전송에 동의하지 않았거나/),
      ).toBeTruthy();
    if (condition === 'retired') await act(() => f.retire());
    if (condition === 'unsupported')
      expect(
        await screen.findByText(
          /선택한 AI에서 사진을 이미지로 전송할 수 없어요/,
        ),
      ).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: '텍스트만 읽어 첨부' }),
    );
    expect(onPickOCR).toHaveBeenCalledTimes(1);
    expect(f.start).not.toHaveBeenCalled();
    expect(f.ordinary).not.toHaveBeenCalled();
    expect(onSendText).not.toHaveBeenCalled();
  },
);

test('Stop cancels the sole native image request and clears its transient preview', async () => {
  const f = await fixture({ hold: true });
  await render(f.view);
  await attach();
  await send();
  await waitFor(() => expect(f.start).toHaveBeenCalledTimes(1));
  await fireEvent.press(screen.getByTestId('rag-conversation-cancel'));
  await waitFor(() => expect(f.cancel).toHaveBeenCalledWith('image-request'));
  expect(screen.queryByTestId('conversation-photo-preview')).toBeNull();
  expect(f.ordinary).not.toHaveBeenCalled();
});

test('a changed composer question invalidates the pending photo approval', async () => {
  const f = await fixture({ holdGrant: true });
  await render(f.view);
  await attach();
  await send();
  expect(ports.grant).toHaveBeenCalledTimes(1);
  const sessionId = f.store.getSnapshot().activeId;
  await act(() => f.store.setDraft(sessionId, 'A newer synthetic question'));
  await act(() => f.release());
  expect(screen.queryByTestId('conversation-photo-consent')).toBeNull();
  expect(f.start).not.toHaveBeenCalled();
  expect(f.session().draft).toBe('A newer synthetic question');
});

test('a completed native reply is never published or saved after its grant retires during the local write', async () => {
  let release!: () => void;
  let start!: () => void;
  const writing = new Promise<void>(resolve => {
    start = resolve;
  });
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const f = await fixture({
    beforeWrite: async () => {
      start();
      await held;
    },
  });
  await render(f.view);
  await attach();
  await send();
  await writing;
  expect(f.start).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('합성 이미지 설명')).toBeNull();
  await act(async () => {
    f.retire();
    release();
  });
  await waitFor(() =>
    expect(screen.queryByTestId('conversation-photo-preview')).toBeNull(),
  );
  expect(screen.queryByText('합성 이미지 설명')).toBeNull();
  expect(
    (await f.storage.listTimeline('selected', 0, undefined, 10, true)).items,
  ).toEqual([]);
  expect(f.session().savedHistoryDisplay).toEqual([]);
  expect(f.start).toHaveBeenCalledTimes(1);
});
