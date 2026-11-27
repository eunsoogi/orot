import { openSavedWebSettingsFixture } from '../../providers/selection/testSupport/SavedWebSearchRoundTrip.fixture';
import { resolveSettingsConsentOwner } from '../../agent/execution/settingsConsentOwner';
import { createDirectPhotoSettingsAuthorization } from '../conversationDirectPhotoAuthorization';
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
  waitFor,
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
beforeEach(() => jest.clearAllMocks());
const first = syntheticDirectJPEG;
const second = '/9j/C//Z';
const third = '/9j/DP/Z';
const photos = [second, first, third];
const attach = () =>
  fireEvent.press(screen.getByRole('button', { name: '사진 첨부' }));
const send = () => fireEvent.press(screen.getByTestId('rag-conversation-send'));

test.each([1, 2])(
  'sends %i ordered surviving photos using only the real Settings grant',
  async count => {
    const f = await directPhotoComposerFixture();
    const owner = (await ports.authorization())!;
    const settings = openSavedWebSettingsFixture(owner.selected);
    const authorize = createDirectPhotoSettingsAuthorization({
      resolveOwner: resolveSettingsConsentOwner,
      readGrant: settings.reloaded.read,
    });
    jest.mocked(ports.grant).mockImplementation(authorize);
    try {
      const selector = await render(settings.selectionView());
      await fireEvent.press(selector.getByTestId('provider-option-0'));
      const confirm = selector.getByTestId('provider-selection-confirm');
      await waitFor(() => expect(confirm).toBeEnabled());
      await fireEvent.press(confirm);
      expect(
        await selector.findByTestId('inference-disclosure-scope'),
      ).toHaveTextContent(/선택한 사진 최대 세 장/);
      await fireEvent.press(
        await selector.findByTestId('inference-disclosure-allow'),
      );
      await waitFor(() => expect(settings.commit).toHaveBeenCalledTimes(1));
      await selector.unmount();

      jest.mocked(ports.pick).mockResolvedValue(photos);
      const mounted = await render(f.view);
      await act(() => f.store.setDraft(f.session().id, '합성 사진 비교'));
      await attach();
      expect(screen.getAllByTestId('conversation-photo-preview')).toHaveLength(
        3,
      );
      await fireEvent.press(
        screen.getAllByRole('button', { name: '첨부 사진 제거' })[1]!,
      );
      if (count === 1)
        await fireEvent.press(
          screen.getAllByRole('button', { name: '첨부 사진 제거' })[1]!,
        );
      await send();
      expect(screen.queryByTestId('conversation-photo-consent')).toBeNull();
      expect(await screen.findByText('합성 이미지 설명')).toBeTruthy();
      expect(f.start).toHaveBeenCalledTimes(1);
      expect(f.start.mock.calls[0]?.[2]).toEqual({
        model: 'gpt-6.2-sol',
        directPhoto: {
          text: '합성 사진 비교',
          ...(count === 1
            ? { jpegBase64: second }
            : { jpegBase64s: [second, third] }),
        },
      });
      expect(f.ordinary).not.toHaveBeenCalled();
      expect(
        screen.getAllByTestId('conversation-sent-photo-image'),
      ).toHaveLength(count);
      expect(JSON.stringify(f.session().savedHistoryDisplay)).not.toContain(
        second,
      );
      await act(() => settings.authority.revoke());
      jest.mocked(ports.pick).mockResolvedValue(photos.slice(0, count));
      await attach();
      await send();
      expect(
        await screen.findByText(/사진 전송에 동의하지 않았거나/),
      ).toBeTruthy();
      expect(screen.queryByTestId('conversation-photo-consent')).toBeNull();
      expect(f.start).toHaveBeenCalledTimes(1);
      await mounted.unmount();
      const reopened = createConversationSessions(f.createOptions());
      await reopened.attachExisting('selected', 0, '2026-10-05T00:00:00.000Z');
      await render(<Transcript store={reopened} />);
      expect(await screen.findByText('합성 이미지 설명')).toBeTruthy();
      expect(screen.queryByTestId('conversation-sent-photo-image')).toBeNull();
      expect(f.start).toHaveBeenCalledTimes(1);
    } finally {
      settings.sql.close();
      f.close();
    }
  },
);

test('keeps a settled group on a picker cancellation or malformed normalization and refuses a send without a Settings grant', async () => {
  const f = await directPhotoComposerFixture({ granted: false });
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
    expect(
      await screen.findByText(/사진 전송에 동의하지 않았거나/),
    ).toBeTruthy();
    expect(screen.queryByTestId('conversation-photo-consent')).toBeNull();
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
  '%s while Settings authorization is pending prevents group dispatch',
  async reason => {
    const f = await directPhotoComposerFixture({ holdGrant: true });
    try {
      jest.mocked(ports.pick).mockResolvedValue(photos);
      await render(f.view);
      await attach();
      await send();
      await waitFor(() => expect(ports.grant).toHaveBeenCalled());
      await act(() => {
        if (reason === 'lock') {
          for (const notify of protectionListeners)
            notify({ kind: 'protectedData', available: false });
        } else f.retire();
        f.release();
      });
      expect(screen.queryByTestId('conversation-photo-consent')).toBeNull();
      expect(screen.queryByTestId('conversation-photo-preview')).toBeNull();
      expect(f.start).not.toHaveBeenCalled();
    } finally {
      f.close();
    }
  },
);
test('accepted group shows one sending row and immediately releases the exact submitted editor', async () => {
  const f = await directPhotoComposerFixture({ hold: true });
  const mounted = await render(f.view);
  try {
    jest.mocked(ports.pick).mockResolvedValue([first, second]);
    await attach();
    await fireEvent.changeText(
      screen.getByTestId('rag-conversation-input'),
      'Original group caption',
    );
    expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
      'Original group caption',
    );
    await send();
    expect(screen.queryByTestId('conversation-photo-consent')).toBeNull();
    await waitFor(() => expect(f.start).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('rag-conversation-input').props.value).toBe('');
    expect(screen.getAllByText('Original group caption')).toHaveLength(1);
    expect(screen.getAllByTestId('conversation-sent-photo-image')).toHaveLength(
      2,
    );
    expect(screen.getAllByText(/전송 중/u)).toHaveLength(1);
    expect(
      screen.queryByText('사진을 안전하게 전송할 준비를 하고 있어요.'),
    ).toBeNull();
    await fireEvent.press(screen.getByTestId('rag-conversation-cancel'));
    await waitFor(() => expect(f.cancel).toHaveBeenCalledWith(f.requestId()));
    expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
      'Original group caption',
    );
    expect(screen.queryByText(/전송 중/u)).toBeNull();
  } finally {
    await mounted.unmount();
    f.close();
  }
});
