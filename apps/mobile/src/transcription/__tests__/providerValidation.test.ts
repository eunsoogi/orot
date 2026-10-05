import {
  AppleOnDeviceSpeechProvider,
  type NativeSpeechTranscriptionResponse,
} from '../index';
import {
  FakeNativeSpeechBridge,
  transcript,
  transcriptionRequest,
} from '../testSupport/providerFixtures';

describe('AppleOnDeviceSpeechProvider validation and errors', () => {
  it('rejects empty audio and unsupported media before crossing the native boundary', async () => {
    const native = new FakeNativeSpeechBridge();
    const provider = new AppleOnDeviceSpeechProvider(native);

    await expect(
      provider.transcribe(
        transcriptionRequest({
          audio: { data: new Uint8Array(), mediaType: 'audio/mp4' },
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'invalid_request',
        message: expect.stringContaining('INVALID_AUDIO:'),
      },
    });
    await expect(
      provider.transcribe(
        transcriptionRequest({
          audio: { data: Uint8Array.from([1]), mediaType: 'text/plain' },
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'unsupported_input',
        message: expect.stringContaining('UNSUPPORTED_MEDIA_TYPE:'),
      },
    });
    expect(native.availabilityCalls).toHaveLength(0);
    expect(native.requests).toHaveLength(0);
  });

  it.each([
    { startSeconds: Number.NaN, endSeconds: 1, text: '시간 오류' },
    { startSeconds: 1, endSeconds: 1, text: '길이 없음' },
    { startSeconds: -1, endSeconds: 1, text: '음수 시작' },
    { startSeconds: 0.2, endSeconds: 2, text: '역순' },
  ])('rejects invalid native segment timestamps: %j', async first => {
    const native = new FakeNativeSpeechBridge();
    native.response = {
      ...transcript,
      segments: [{ startSeconds: 0.4, endSeconds: 1, text: '첫 구간' }, first],
    };
    const provider = new AppleOnDeviceSpeechProvider(native);

    await expect(
      provider.transcribe(transcriptionRequest()),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'internal_error',
        message: expect.stringContaining('INVALID_TRANSCRIPTION_RESULT:'),
      },
    });
  });

  it('rejects transcription responses without segment timestamps', async () => {
    const native = new FakeNativeSpeechBridge();
    native.response = {
      text: '시간이 없는 결과',
      language: 'ko-KR',
    } as NativeSpeechTranscriptionResponse;
    const provider = new AppleOnDeviceSpeechProvider(native);

    await expect(
      provider.transcribe(transcriptionRequest()),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'internal_error',
        message: expect.stringContaining('INVALID_TRANSCRIPTION_RESULT:'),
      },
    });
  });

  it.each([
    ['PERMISSION_DENIED', 'unsupported_capability', 'PERMISSION_DENIED:'],
    [
      'PERMISSION_RESTRICTED',
      'unsupported_capability',
      'PERMISSION_RESTRICTED:',
    ],
    [
      'RECOGNIZER_UNAVAILABLE',
      'provider_unavailable',
      'RECOGNIZER_UNAVAILABLE:',
    ],
    ['MODEL_INSTALL_FAILED', 'provider_unavailable', 'MODEL_UNAVAILABLE:'],
    ['INVALID_AUDIO', 'invalid_request', 'INVALID_AUDIO:'],
    ['UNSUPPORTED_MEDIA_TYPE', 'unsupported_input', 'UNSUPPORTED_MEDIA_TYPE:'],
    [
      'NATIVE_MODULE_UNAVAILABLE',
      'provider_unavailable',
      'NATIVE_MODULE_UNAVAILABLE:',
    ],
    [
      'AUDIO_STORAGE_UNPROTECTED',
      'provider_unavailable',
      'AUDIO_STORAGE_UNPROTECTED:',
    ],
  ] as const)(
    'maps native failure %s to a typed provider error',
    async (code, errorCode, message) => {
      const native = new FakeNativeSpeechBridge();
      native.status = 'permission_not_determined';
      native.error = Object.assign(new Error('native detail'), { code });
      const provider = new AppleOnDeviceSpeechProvider(native);

      await expect(
        provider.transcribe(transcriptionRequest()),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: errorCode, message: expect.stringContaining(message) },
      });
    },
  );

  it('returns unsupported availability for a non-Korean query without calling the native module', async () => {
    const native = new FakeNativeSpeechBridge();
    const provider = new AppleOnDeviceSpeechProvider(native);

    await expect(provider.getAvailability('en-US')).resolves.toEqual({
      status: 'unsupported_language',
      engine: 'none',
      locale: 'en-US',
    });
    expect(native.availabilityCalls).toHaveLength(0);
  });
});
