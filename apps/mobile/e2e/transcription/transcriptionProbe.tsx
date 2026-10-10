import { useEffect, useState } from 'react';
import type { SpeechAvailability } from '../../src/transcription';
import {
  AppleOnDeviceSpeechProvider,
  appleSpeechTranscriptionNativeBridge,
  ON_DEVICE_SPEECH_PROVIDER_ID,
} from '../../src/transcription';
import { createSyntheticFixtureNativeBridge } from '../../src/transcription/testSupport/syntheticFixtureBridge';
import { evaluateSyntheticSpeech } from '../../src/transcription/accuracyEvaluation';
import { decodeAudioBase64 } from '../../src/transcription/base64';
import TranscriptionProbeView from './TranscriptionProbeView';
import syntheticFixture from './fixtures/synthetic-korean.json';

interface SyntheticTranscriptionCase {
  readonly id: string;
  readonly expectedText: string;
  readonly medicationName?: string;
  readonly numberForms?: readonly string[];
  readonly negationForms?: readonly string[];
  readonly audio: {
    readonly mediaType: string;
    readonly durationSeconds: number;
    readonly sha256: string;
    readonly base64: string;
  };
}

interface SyntheticTranscriptionFixture {
  readonly schemaVersion: number;
  readonly provenance: {
    readonly synthetic: boolean;
    readonly generator: string;
    readonly voice: string;
    readonly encoding: string;
    readonly note: string;
  };
  readonly cases: readonly SyntheticTranscriptionCase[];
}

interface TranscriptionCaseObservation {
  readonly id: string;
  readonly inputSha256: string;
  readonly expectedText: string;
  readonly recognizedText: string;
  readonly accuracy: ReturnType<typeof evaluateSyntheticSpeech>;
  readonly segments: readonly {
    readonly startSeconds: number;
    readonly endSeconds: number;
    readonly text: string;
  }[];
}

export interface TranscriptionProbeReport {
  readonly outcome:
    'running' | 'measured' | 'explicitly_unsupported' | 'failed';
  readonly providerId: string;
  readonly fixture: SyntheticTranscriptionFixture['provenance'];
  readonly initialAvailability?: SpeechAvailability;
  readonly cases: readonly TranscriptionCaseObservation[];
  readonly reason?: { readonly code: string; readonly message: string };
}

const fixture = syntheticFixture as SyntheticTranscriptionFixture;
const fixtureNativeBridge = createSyntheticFixtureNativeBridge(
  appleSpeechTranscriptionNativeBridge,
  fixture.provenance.synthetic,
);
const fixtureSpeechProvider = new AppleOnDeviceSpeechProvider(
  fixtureNativeBridge,
);
const EXPLICITLY_UNSUPPORTED = new Set([
  'unsupported_language',
  'unsupported_device',
  'model_unavailable',
  'permission_denied',
  'permission_restricted',
  'recognizer_unavailable',
]);
const EXPLICIT_UNSUPPORTED_PREFIXES = [
  'UNSUPPORTED_LANGUAGE:',
  'UNSUPPORTED_DEVICE:',
  'MODEL_UNAVAILABLE:',
  'PERMISSION_NOT_DETERMINED:',
  'PERMISSION_DENIED:',
  'PERMISSION_RESTRICTED:',
  'RECOGNIZER_UNAVAILABLE:',
];

// The probe sends bundled synthetic audio through the real provider and never substitutes mock transcripts.
export function TranscriptionProbe() {
  const [report, setReport] = useState<TranscriptionProbeReport>({
    outcome: 'running',
    providerId: ON_DEVICE_SPEECH_PROVIDER_ID,
    fixture: fixture.provenance,
    cases: [],
  });

  useEffect(() => {
    let mounted = true;
    runNativeProbe().then(
      next => {
        if (mounted) setReport(next);
      },
      error => {
        if (mounted)
          setReport({
            outcome: 'failed',
            providerId: ON_DEVICE_SPEECH_PROVIDER_ID,
            fixture: fixture.provenance,
            cases: [],
            reason: normalizeError(error),
          });
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  return <TranscriptionProbeView report={report} />;
}

async function runNativeProbe(): Promise<TranscriptionProbeReport> {
  if (!fixture.provenance.synthetic) {
    throw new Error(
      'The Simulator storage exception requires a fixture marked synthetic.',
    );
  }

  const initialAvailability =
    await fixtureSpeechProvider.getAvailability('ko-KR');
  if (EXPLICITLY_UNSUPPORTED.has(initialAvailability.status)) {
    return {
      outcome: 'explicitly_unsupported',
      providerId: ON_DEVICE_SPEECH_PROVIDER_ID,
      fixture: fixture.provenance,
      initialAvailability,
      cases: [],
      reason: {
        code: initialAvailability.status,
        message:
          'The native Apple API reported this Korean transcription capability as unavailable.',
      },
    };
  }
  if (
    initialAvailability.status !== 'available' &&
    initialAvailability.status !== 'permission_not_determined'
  ) {
    return {
      outcome: 'failed',
      providerId: ON_DEVICE_SPEECH_PROVIDER_ID,
      fixture: fixture.provenance,
      initialAvailability,
      cases: [],
      reason: {
        code: 'INVALID_AVAILABILITY_STATUS',
        message: 'The native module returned an unknown availability status.',
      },
    };
  }

  const cases: TranscriptionCaseObservation[] = [];
  for (const speechCase of fixture.cases) {
    const result = await fixtureSpeechProvider.transcribe({
      language: 'ko-KR',
      audio: {
        data: decodeAudioBase64(speechCase.audio.base64),
        mediaType: speechCase.audio.mediaType,
      },
    });
    if (!result.ok) {
      const reason = { code: result.error.code, message: result.error.message };
      return {
        outcome: hasExplicitUnsupportedPrefix(reason.message)
          ? 'explicitly_unsupported'
          : 'failed',
        providerId: ON_DEVICE_SPEECH_PROVIDER_ID,
        fixture: fixture.provenance,
        initialAvailability,
        cases,
        reason,
      };
    }

    const segments = result.value.segments ?? [];
    cases.push({
      id: speechCase.id,
      inputSha256: speechCase.audio.sha256,
      expectedText: speechCase.expectedText,
      recognizedText: result.value.text,
      accuracy: evaluateSyntheticSpeech(speechCase, result.value.text),
      segments: segments.map(segment => ({
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        text: segment.text,
      })),
    });
  }

  return {
    outcome: 'measured',
    providerId: ON_DEVICE_SPEECH_PROVIDER_ID,
    fixture: fixture.provenance,
    initialAvailability,
    cases,
  };
}

function hasExplicitUnsupportedPrefix(message: string): boolean {
  return EXPLICIT_UNSUPPORTED_PREFIXES.some(prefix =>
    message.startsWith(prefix),
  );
}

function normalizeError(error: unknown): { code: string; message: string } {
  const value = error as { code?: unknown; message?: unknown } | null;
  return {
    code:
      typeof value?.code === 'string'
        ? value.code
        : 'TRANSCRIPTION_PROBE_FAILED',
    message: typeof value?.message === 'string' ? value.message : String(error),
  };
}
