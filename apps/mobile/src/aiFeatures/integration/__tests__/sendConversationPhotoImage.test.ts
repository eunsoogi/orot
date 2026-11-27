import { t } from '../../../i18n';
import { createConversationPhotoImageSend } from '../sendConversationPhotoImage';
import {
  setupPhotoSend,
  syntheticDirectJPEG,
} from '../testSupport/directPhotoSendFixture';

test('an exact approved no-text photo crosses only the dedicated Plan wire once', async () => {
  const f = setupPhotoSend();
  const send = createConversationPhotoImageSend(f.input);
  await expect(send()).resolves.toEqual({
    status: 'answer',
    text: '합성 사진 설명',
  });
  await expect(send()).resolves.toEqual({ status: 'cancelled' });
  expect(f.input.confirm).toHaveBeenCalledTimes(1);
  expect(f.input.confirm.mock.calls[0]?.[0]).toEqual({
    providerName: 'Synthetic model (ChatGPT plan)',
    modelName: 'Synthetic model',
    recipient: t('nextVisit.recipient.chatgpt'),
    includesPrompt: false,
    transfer: 'image',
  });
  expect(f.startPhotoResponse).toHaveBeenCalledTimes(1);
  expect(f.startPhotoResponse).toHaveBeenCalledWith(
    'one-synthetic-request',
    'synthetic-owner',
    {
      model: 'synthetic-declared-model',
      directPhoto: { jpegBase64: syntheticDirectJPEG, text: '' },
    },
  );
  expect(f.ordinaryStart).not.toHaveBeenCalled();
});

test.each([
  ['decline', { approve: false }, 'refused'],
  ['no declaration', { supportsPhoto: false }, 'unsupported'],
  ['no dedicated transport', { hasTransport: false }, 'unsupported'],
] as const)(
  '%s cannot send an image or an OCR substitute',
  async (_name, options, status) => {
    const f = setupPhotoSend(options);
    await expect(createConversationPhotoImageSend(f.input)()).resolves.toEqual({
      status,
    });
    expect(f.startPhotoResponse).not.toHaveBeenCalled();
    expect(f.ordinaryStart).not.toHaveBeenCalled();
    expect(f.input.confirm).toHaveBeenCalledTimes(status === 'refused' ? 1 : 0);
  },
);

test('a mismatched selected model or undisclosed destination cannot borrow the image port', async () => {
  const f = setupPhotoSend();
  const old = f.input.selected;
  for (const selected of [
    { ...old, recipient: 'Different destination' },
    {
      ...old,
      modelId: 'different',
      option: { ...old.option, modelId: 'different' },
      selection: { ...old.selection, modelId: 'different' },
    },
  ]) {
    await expect(
      createConversationPhotoImageSend({ ...f.input, selected })(),
    ).resolves.toEqual({ status: 'unsupported' });
  }
  expect(f.input.confirm).not.toHaveBeenCalled();
  expect(f.startPhotoResponse).not.toHaveBeenCalled();
});

test('rejects a URL or oversized or non-JPEG payload before the explicit decision', async () => {
  const f = setupPhotoSend();
  for (const jpegBase64 of [
    'https://example.invalid/photo',
    '/9j/' + 'A'.repeat(3_000_000),
    'YWJjZGVm',
  ]) {
    await expect(
      createConversationPhotoImageSend({ ...f.input, jpegBase64 })(),
    ).resolves.toEqual({ status: 'invalid' });
  }
  expect(f.input.confirm).not.toHaveBeenCalled();
  expect(f.startPhotoResponse).not.toHaveBeenCalled();
});

test('removal while approval is pending cannot produce late dispatch', async () => {
  const f = setupPhotoSend();
  let release!: (value: boolean) => void;
  let entered!: () => void;
  const shown = new Promise<void>(resolve => {
    entered = resolve;
  });
  const send = createConversationPhotoImageSend({
    ...f.input,
    confirm() {
      entered();
      return new Promise(resolve => {
        release = resolve;
      });
    },
  });
  const result = send();
  await shown;
  f.retire();
  release(true);
  await expect(result).resolves.toEqual({ status: 'cancelled' });
  expect(f.startPhotoResponse).not.toHaveBeenCalled();
});

test('rechecks owner synchronously at the native start, after subscribing', async () => {
  const f = setupPhotoSend({ onSubscribe: () => f.retire() });
  await expect(createConversationPhotoImageSend(f.input)()).resolves.toEqual({
    status: 'cancelled',
  });
  expect(f.startPhotoResponse).not.toHaveBeenCalled();
});

test.each([false, true])(
  'Stop cancels only the exact photo request, acknowledged before Stop: %s',
  async acknowledged => {
    const f = setupPhotoSend({ holdNative: true });
    let started!: () => void;
    let acknowledge!: () => void;
    const native = new Promise<void>(resolve => {
      started = resolve;
    });
    const registration = new Promise<void>(resolve => {
      acknowledge = resolve;
    });
    const afterBridgeContinuation = () =>
      new Promise<void>(resolve => setImmediate(resolve));
    f.startPhotoResponse.mockImplementation(() => {
      started();
      return registration;
    });
    const result = createConversationPhotoImageSend({
      ...f.input,
      prompt: '합성 설명 요청',
    })();
    await native;
    if (acknowledged) {
      acknowledge();
      await afterBridgeContinuation();
    }
    f.controller.abort();
    await expect(result).resolves.toEqual({ status: 'cancelled' });
    expect(f.input.confirm.mock.calls[0]?.[0]).toMatchObject({
      includesPrompt: true,
    });
    expect(f.cancelResponse.mock.calls).toEqual([['one-synthetic-request']]);
    if (!acknowledged) {
      acknowledge();
      await afterBridgeContinuation();
      expect(f.cancelResponse.mock.calls).toEqual([
        ['one-synthetic-request'],
        ['one-synthetic-request'],
      ]);
    }
    expect(f.startPhotoResponse).toHaveBeenCalledTimes(1);
    expect(f.ordinaryStart).not.toHaveBeenCalled();
  },
);

test('a native refusal never switches models or falls back to text', async () => {
  const f = setupPhotoSend();
  f.startPhotoResponse.mockRejectedValueOnce(
    new Error('synthetic transport refusal'),
  );
  await expect(createConversationPhotoImageSend(f.input)()).resolves.toEqual({
    status: 'unavailable',
  });
  expect(f.startPhotoResponse).toHaveBeenCalledTimes(1);
  expect(f.ordinaryStart).not.toHaveBeenCalled();
});

test.each(['reject', 'retire'] as const)(
  'an exact pre-native handoff cannot bypass the stock current fence: %s',
  async mode => {
    const f = setupPhotoSend();
    const handoff = jest.fn(() => {
      if (mode === 'reject') return false;
      f.retire();
      return true;
    });
    await expect(
      createConversationPhotoImageSend({
        ...f.input,
        beforeNativeStart: handoff,
      })(),
    ).resolves.toEqual({
      status: mode === 'reject' ? 'unavailable' : 'cancelled',
    });
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(f.startPhotoResponse).not.toHaveBeenCalled();
    expect(f.ordinaryStart).not.toHaveBeenCalled();
  },
);
