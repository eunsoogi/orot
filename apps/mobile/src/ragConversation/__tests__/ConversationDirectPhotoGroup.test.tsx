import { createConversationSessions } from '../conversationSessions';
import { Transcript } from '../testSupport/savedHistoryDisplayFixture';
import { AppState } from 'react-native';
import { conversationExecutionNative } from '../conversationExecutionNative';
import type { ConversationExecutionEvent } from '../conversationExecutionLease';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { syntheticDirectJPEG } from '../../aiFeatures/integration/testSupport/directPhotoSendFixture';
import { conversationDirectPhotoPorts as ports } from '../conversationDirectPhotoPorts';
import { directPhotoComposerFixture } from '../testSupport/directPhotoComposerFixture';

jest.mock('../conversationDirectPhotoPorts', () => ({
  conversationDirectPhotoPorts: {
    hasPicker: jest.fn(() => true),
    pick: jest.fn(),
    authorization: jest.fn(),
    grant: jest.fn(),
  },
}));
jest.mock('../conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));
const protectionListeners = new Set<
  (event: ConversationExecutionEvent) => void
>();
const previousPhase = AppState.currentState;
beforeEach(() => {
  AppState.currentState = 'active';
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    protectedDataAvailable: async () => true,
    subscribe(listener) {
      protectionListeners.add(listener);
      return () => {
        protectionListeners.delete(listener);
      };
    },
    begin: async () => true,
    end: () => {},
    isActive: async () => true,
  });
});
afterEach(() => {
  AppState.currentState = previousPhase;
  protectionListeners.clear();
});
const first = syntheticDirectJPEG;
const second = '/9j/C//Z';
const third = '/9j/DP/Z';
const photos = [second, first, third];
const attach = () =>
  fireEvent.press(screen.getByRole('button', { name: '사진 첨부' }));
const send = () => fireEvent.press(screen.getByTestId('rag-conversation-send'));
const approve = () =>
  fireEvent.press(screen.getByRole('button', { name: '동의하고 계속' }));

test('reviews the exact ordered surviving thumbnails and sends one typed image group', async () => {
  const f = await directPhotoComposerFixture();
  try {
    jest.mocked(ports.pick).mockResolvedValue(photos);
    const mounted = await render(f.view);
    await act(() => f.store.setDraft(f.session().id, '합성 사진 비교'));
    await attach();
    expect(screen.getAllByTestId('conversation-photo-preview')).toHaveLength(3);
    await fireEvent.press(
      screen.getAllByRole('button', { name: '첨부 사진 제거' })[1]!,
    );
    await send();
    expect(f.start).not.toHaveBeenCalled();
    expect(
      screen.getByText('미리보기 순서대로 사진 2장과 입력한 질문을 보내요.'),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('conversation-photo-consent')).getAllByText(
        /Synthetic image model/,
      ),
    ).not.toHaveLength(0);
    await approve();
    expect(await screen.findByText('합성 이미지 설명')).toBeTruthy();
    expect(f.start).toHaveBeenCalledTimes(1);
    expect(f.start.mock.calls[0]?.[2]).toEqual({
      model: 'gpt-6.2-sol',
      directPhoto: { text: '합성 사진 비교', jpegBase64s: [second, third] },
    });
    expect(f.ordinary).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('conversation-sent-photo-image')).toHaveLength(
      2,
    );
    expect(JSON.stringify(f.session().savedHistoryDisplay)).not.toContain(
      second,
    );
    await mounted.unmount();
    const reopened = createConversationSessions(f.createOptions());
    await reopened.attachExisting('selected', 0, '2026-10-05T00:00:00.000Z');
    await render(<Transcript store={reopened} />);
    expect(await screen.findByText('합성 이미지 설명')).toBeTruthy();
    expect(screen.queryByTestId('conversation-sent-photo-image')).toBeNull();
    expect(f.start).toHaveBeenCalledTimes(1);
  } finally {
    f.close();
  }
});

test('keeps a settled group on a picker cancellation or malformed normalization and refuses cancelled review', async () => {
  const f = await directPhotoComposerFixture();
  try {
    jest
      .mocked(ports.pick)
      .mockResolvedValueOnce(photos)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([first, 'invalid']);
    await render(f.view);
    await attach();
    await attach();
    expect(screen.getAllByTestId('conversation-photo-preview')).toHaveLength(3);
    await attach();
    expect(screen.getByText(/사진을 준비할 수 없어요/)).toBeTruthy();
    expect(screen.getAllByTestId('conversation-photo-preview')).toHaveLength(3);
    await send();
    expect(screen.getByTestId('conversation-photo-consent')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
    expect(f.start).not.toHaveBeenCalled();
    expect(f.ordinary).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});

test('does not allow an unsupported selected model to review or send a group', async () => {
  const f = await directPhotoComposerFixture({ supported: false });
  try {
    jest.mocked(ports.pick).mockResolvedValue(photos);
    await render(f.view);
    await attach();
    await send();
    expect(screen.queryByTestId('conversation-photo-consent')).toBeNull();
    expect(f.start).not.toHaveBeenCalled();
    expect(f.ordinary).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});

test.each(['lock', 'destination replacement'] as const)(
  '%s while reviewing retires the whole group and prevents dispatch',
  async reason => {
    const f = await directPhotoComposerFixture();
    try {
      jest.mocked(ports.pick).mockResolvedValue(photos);
      await render(f.view);
      await attach();
      await send();
      const staleApprove = screen.getByRole('button', {
        name: '동의하고 계속',
      });
      await act(() => {
        if (reason === 'lock') {
          for (const notify of protectionListeners)
            notify({ kind: 'protectedData', available: false });
        } else f.retire();
      });
      expect(screen.queryByTestId('conversation-photo-consent')).toBeNull();
      expect(screen.queryByTestId('conversation-photo-preview')).toBeNull();
      await fireEvent.press(staleApprove);
      expect(f.start).not.toHaveBeenCalled();
    } finally {
      f.close();
    }
  },
);
