import type {
  TranscriptionRequest,
} from '@orot/model-runtime';
import {
  AppleOnDeviceSpeechProvider,
  ON_DEVICE_SPEECH_CAPABILITIES,
  type NativeSpeechTranscriptionBridge,
  type NativeSpeechTranscriptionRequest,
  type NativeSpeechTranscriptionResponse,
  type SpeechAvailability,
  type SpeechAvailabilityStatus,
} from '../index';

const transcript: NativeSpeechTranscriptionResponse = {
  text: '가상 약품 500밀리그램을 복용하지 않았어요.',
  language: 'ko-KR',
  segments: [
    { startSeconds: 0.2, endSeconds: 1.3, text: '가상 약품 500밀리그램을' },
    { startSeconds: 1.4, endSeconds: 2.8, text: '복용하지 않았어요.' },
  ],
  engine: 'speech_transcriber',
};

class FakeNativeSpeechBridge implements NativeSpeechTranscriptionBridge {
  status: SpeechAvailabilityStatus = 'available';
  engine: SpeechAvailability['engine'] = 'speech_transcriber';
  response: NativeSpeechTranscriptionResponse = transcript;
  error?: Error & { code?: string };
  availabilityCalls: string[] = [];
  requests: NativeSpeechTranscriptionRequest[] = [];

  async getAvailability(language: string): Promise<SpeechAvailability> {
    this.availabilityCalls.push(language);
    return { status: this.status, engine: this.engine, locale: language, modelInstalled: true };
  }

  async transcribe(nativeRequest: NativeSpeechTranscriptionRequest): Promise<NativeSpeechTranscriptionResponse> {
    this.requests.push(nativeRequest);
    if (this.error) throw this.error;
    return this.response;
  }
}

function transcriptionRequest(overrides: Partial<TranscriptionRequest> = {}): TranscriptionRequest {
  return {
    audio: { data: Uint8Array.from([77, 97, 110]), mediaType: 'audio/mp4' },
    ...overrides,
  };
}

describe('AppleOnDeviceSpeechProvider', () => {
  it('advertises audio-only, non-streaming transcription', () => {
    const provider = new AppleOnDeviceSpeechProvider(new FakeNativeSpeechBridge());

    expect(provider.kind).toBe('transcription');
    expect(provider.id).toBe('apple-on-device-speech');
    expect(provider.capabilities).toEqual(ON_DEVICE_SPEECH_CAPABILITIES);
    expect(provider.capabilities).toEqual({ inputTypes: ['audio'], streaming: false });
  });

  it('passes Korean audio to the native Apple boundary and returns timestamped segments', async () => {
    const native = new FakeNativeSpeechBridge();
    const provider = new AppleOnDeviceSpeechProvider(native);

    await expect(provider.transcribe(transcriptionRequest({ language: 'ko' }))).resolves.toEqual({
      ok: true,
      value: {
        text: transcript.text,
        language: 'ko-KR',
        segments: transcript.segments,
      },
    });
    expect(native.availabilityCalls).toEqual(['ko-KR']);
    expect(native.requests).toEqual([{
      audioBase64: 'TWFu',
      mediaType: 'audio/mp4',
      language: 'ko-KR',
    }]);
  });

  it('normalizes Korean regional tags to the tested Korean locale', async () => {
    const native = new FakeNativeSpeechBridge();
    const provider = new AppleOnDeviceSpeechProvider(native);

    await provider.transcribe(transcriptionRequest({ language: 'KO-kr' }));

    expect(native.availabilityCalls).toEqual(['ko-KR']);
    expect(native.requests[0].language).toBe('ko-KR');
  });

  it('reports unsupported languages without calling Apple speech', async () => {
    const native = new FakeNativeSpeechBridge();
    const provider = new AppleOnDeviceSpeechProvider(native);

    await expect(provider.transcribe(transcriptionRequest({ language: 'en-US' }))).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'unsupported_capability',
        message: expect.stringContaining('UNSUPPORTED_LANGUAGE:'),
        retryable: false,
      },
    });
    expect(native.availabilityCalls).toHaveLength(0);
    expect(native.requests).toHaveLength(0);
  });

  it.each([
    ['unsupported_language', 'unsupported_capability', 'UNSUPPORTED_LANGUAGE:', false],
    ['unsupported_device', 'unsupported_capability', 'UNSUPPORTED_DEVICE:', false],
    ['model_unavailable', 'provider_unavailable', 'MODEL_UNAVAILABLE:', true],
    ['permission_denied', 'unsupported_capability', 'PERMISSION_DENIED:', false],
    ['permission_restricted', 'unsupported_capability', 'PERMISSION_RESTRICTED:', false],
    ['recognizer_unavailable', 'provider_unavailable', 'RECOGNIZER_UNAVAILABLE:', true],
  ] as const)(
    'preserves the explicit %s availability state',
    async (status, code, message, retryable) => {
      const native = new FakeNativeSpeechBridge();
      native.status = status as SpeechAvailabilityStatus;
      const provider = new AppleOnDeviceSpeechProvider(native);

      await expect(provider.transcribe(transcriptionRequest())).resolves.toMatchObject({
        ok: false,
        error: { code, message: expect.stringContaining(message), retryable },
      });
      expect(native.requests).toHaveLength(0);
    },
  );

  it('lets the native boundary request first-use permission after the user starts transcription', async () => {
    const native = new FakeNativeSpeechBridge();
    native.status = 'permission_not_determined';
    native.engine = 'on_device_speech_recognizer';
    const provider = new AppleOnDeviceSpeechProvider(native);

    await expect(provider.transcribe(transcriptionRequest())).resolves.toMatchObject({ ok: true });
    expect(native.requests).toHaveLength(1);
  });

  it('rejects empty audio and unsupported media before crossing the native boundary', async () => {
    const native = new FakeNativeSpeechBridge();
    const provider = new AppleOnDeviceSpeechProvider(native);

    await expect(provider.transcribe(transcriptionRequest({
      audio: { data: new Uint8Array(), mediaType: 'audio/mp4' },
    }))).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_request', message: expect.stringContaining('INVALID_AUDIO:') },
    });
    await expect(provider.transcribe(transcriptionRequest({
      audio: { data: Uint8Array.from([1]), mediaType: 'text/plain' },
    }))).resolves.toMatchObject({
      ok: false,
      error: { code: 'unsupported_input', message: expect.stringContaining('UNSUPPORTED_MEDIA_TYPE:') },
    });
    expect(native.availabilityCalls).toHaveLength(0);
    expect(native.requests).toHaveLength(0);
  });

  it.each([
    { startSeconds: Number.NaN, endSeconds: 1, text: '시간 오류' },
    { startSeconds: 1, endSeconds: 1, text: '길이 없음' },
    { startSeconds: -1, endSeconds: 1, text: '음수 시작' },
    { startSeconds: 0.2, endSeconds: 2, text: '역순' },
  ])('rejects invalid native segment timestamps: %j', async (first) => {
    const native = new FakeNativeSpeechBridge();
    native.response = {
      ...transcript,
      segments: [
        { startSeconds: 0.4, endSeconds: 1, text: '첫 구간' },
        first,
      ],
    };
    const provider = new AppleOnDeviceSpeechProvider(native);

    await expect(provider.transcribe(transcriptionRequest())).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal_error', message: expect.stringContaining('INVALID_TRANSCRIPTION_RESULT:') },
    });
  });

  it('rejects transcription responses without segment timestamps', async () => {
    const native = new FakeNativeSpeechBridge();
    native.response = { text: '시간이 없는 결과', language: 'ko-KR' } as NativeSpeechTranscriptionResponse;
    const provider = new AppleOnDeviceSpeechProvider(native);

    await expect(provider.transcribe(transcriptionRequest())).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal_error', message: expect.stringContaining('INVALID_TRANSCRIPTION_RESULT:') },
    });
  });

  it.each([
    ['PERMISSION_DENIED', 'unsupported_capability', 'PERMISSION_DENIED:'],
    ['PERMISSION_RESTRICTED', 'unsupported_capability', 'PERMISSION_RESTRICTED:'],
    ['RECOGNIZER_UNAVAILABLE', 'provider_unavailable', 'RECOGNIZER_UNAVAILABLE:'],
    ['MODEL_INSTALL_FAILED', 'provider_unavailable', 'MODEL_UNAVAILABLE:'],
    ['INVALID_AUDIO', 'invalid_request', 'INVALID_AUDIO:'],
    ['UNSUPPORTED_MEDIA_TYPE', 'unsupported_input', 'UNSUPPORTED_MEDIA_TYPE:'],
    ['NATIVE_MODULE_UNAVAILABLE', 'provider_unavailable', 'NATIVE_MODULE_UNAVAILABLE:'],
    ['AUDIO_STORAGE_UNPROTECTED', 'provider_unavailable', 'AUDIO_STORAGE_UNPROTECTED:'],
  ] as const)('maps native failure %s to a typed provider error', async (code, errorCode, message) => {
    const native = new FakeNativeSpeechBridge();
    native.status = 'permission_not_determined';
    native.error = Object.assign(new Error('native detail'), { code });
    const provider = new AppleOnDeviceSpeechProvider(native);

    await expect(provider.transcribe(transcriptionRequest())).resolves.toMatchObject({
      ok: false,
      error: { code: errorCode, message: expect.stringContaining(message) },
    });
  });

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
