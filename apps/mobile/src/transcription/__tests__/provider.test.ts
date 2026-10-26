import {
  AppleOnDeviceSpeechProvider,
  ON_DEVICE_SPEECH_CAPABILITIES,
  type SpeechAvailabilityStatus,
} from '../index';
import {
  FakeNativeSpeechBridge,
  transcript,
  transcriptionRequest,
} from '../testSupport/providerFixtures';

describe('AppleOnDeviceSpeechProvider availability and contract', () => {
  it('advertises audio-only, non-streaming transcription', () => {
    const provider = new AppleOnDeviceSpeechProvider(
      new FakeNativeSpeechBridge(),
    );

    expect(provider.kind).toBe('transcription');
    expect(provider.id).toBe('apple-on-device-speech');
    expect(provider.capabilities).toEqual(ON_DEVICE_SPEECH_CAPABILITIES);
    expect(provider.capabilities).toEqual({
      inputTypes: ['audio'],
      streaming: false,
    });
  });

  it('passes Korean audio to the native Apple boundary and returns timestamped segments', async () => {
    const native = new FakeNativeSpeechBridge();
    const provider = new AppleOnDeviceSpeechProvider(native);

    await expect(
      provider.transcribe(transcriptionRequest({ language: 'ko' })),
    ).resolves.toEqual({
      ok: true,
      value: {
        text: transcript.text,
        language: 'ko-KR',
        segments: transcript.segments,
        engine: transcript.engine,
        runtimeVersion: transcript.runtimeVersion,
        recordingDurationMs: transcript.recordingDurationMs,
      },
    });
    expect(native.availabilityCalls).toEqual([]);
    expect(native.requests).toHaveLength(1);
    expect(native.requests[0]).toMatchObject({
      requestId: expect.any(String),
      audioBase64: 'TWFu',
      mediaType: 'audio/mp4',
      language: 'ko-KR',
    });
  });

  it('normalizes Korean regional tags to the tested Korean locale', async () => {
    const native = new FakeNativeSpeechBridge();
    const provider = new AppleOnDeviceSpeechProvider(native);

    await provider.transcribe(transcriptionRequest({ language: 'KO-kr' }));

    expect(native.availabilityCalls).toEqual([]);
    expect(native.requests[0].language).toBe('ko-KR');
  });

  it('transcribes a saved recording through the native file boundary and preserves runtime provenance', async () => {
    const native = new FakeNativeSpeechBridge();
    const provider = new AppleOnDeviceSpeechProvider(native);

    await expect(
      provider.transcribeRecording({
        recordingId: 'recording-1',
        language: 'ko',
      }),
    ).resolves.toMatchObject({ ok: true, value: transcript });
    expect(native.availabilityCalls).toEqual([]);
    expect(native.recordingRequests).toHaveLength(1);
    expect(native.recordingRequests[0]).toMatchObject({
      requestId: expect.any(String),
      recordingId: 'recording-1',
      language: 'ko-KR',
    });
    expect(native.requests).toHaveLength(0);
  });

  it('reports unsupported languages without calling Apple speech', async () => {
    const native = new FakeNativeSpeechBridge();
    const provider = new AppleOnDeviceSpeechProvider(native);

    await expect(
      provider.transcribe(transcriptionRequest({ language: 'en-US' })),
    ).resolves.toMatchObject({
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
    [
      'unsupported_language',
      'unsupported_capability',
      'UNSUPPORTED_LANGUAGE:',
      false,
    ],
    [
      'unsupported_device',
      'unsupported_capability',
      'UNSUPPORTED_DEVICE:',
      false,
    ],
    ['model_unavailable', 'provider_unavailable', 'MODEL_UNAVAILABLE:', true],
    [
      'permission_denied',
      'unsupported_capability',
      'PERMISSION_DENIED:',
      false,
    ],
    [
      'permission_restricted',
      'unsupported_capability',
      'PERMISSION_RESTRICTED:',
      false,
    ],
    [
      'recognizer_unavailable',
      'provider_unavailable',
      'RECOGNIZER_UNAVAILABLE:',
      true,
    ],
  ] as const)(
    'preserves the explicit %s availability state',
    async (status, code, message, retryable) => {
      const native = new FakeNativeSpeechBridge();
      native.status = status as SpeechAvailabilityStatus;
      const provider = new AppleOnDeviceSpeechProvider(native);

      await expect(
        provider.transcribe(transcriptionRequest()),
      ).resolves.toMatchObject({
        ok: false,
        error: { code, message: expect.stringContaining(message), retryable },
      });
      expect(native.requests).toHaveLength(1);
    },
  );

  it('lets the native boundary request first-use permission after the user starts transcription', async () => {
    const native = new FakeNativeSpeechBridge();
    native.status = 'permission_not_determined';
    native.engine = 'on_device_speech_recognizer';
    const provider = new AppleOnDeviceSpeechProvider(native);

    await expect(
      provider.transcribe(transcriptionRequest()),
    ).resolves.toMatchObject({ ok: true });
    expect(native.requests).toHaveLength(1);
  });
});
