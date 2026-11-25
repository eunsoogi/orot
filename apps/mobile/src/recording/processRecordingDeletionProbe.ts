import { NativeModules } from 'react-native';
import type {
  RecordingDeletionTimingMark,
  RecordingDeletionTimingProbe,
  RecordingDeletionTimingSpan,
  RecordingDeletionTimingOutcome,
} from './recordingDeletionTiming';

type OptInSink = {
  readonly enabled?: boolean;
  report(feature: string, stage: string, outcome: string): void;
};

function sink(): OptInSink | undefined {
  try {
    const current = NativeModules.OrotProviderDiagnostics as
      OptInSink | undefined;
    return current?.enabled === true ? current : undefined;
  } catch {
    return undefined;
  }
}

function report(
  stage:
    RecordingDeletionTimingMark | RecordingDeletionTimingSpan | 'operation',
  outcome: 'started' | 'completed' | 'failed',
) {
  try {
    sink()?.report('recording_delete', stage.replaceAll('-', '_'), outcome);
  } catch {
    // An opt-in bridge failure cannot alter the protected operation or its UI.
  }
}

const settled = (outcome: RecordingDeletionTimingOutcome) =>
  outcome === 'success' ? 'completed' : 'failed';

const processProbe: RecordingDeletionTimingProbe = {
  mark: stage => report(stage, 'completed'),
  begin: stage => report(stage, 'started'),
  end: (stage, outcome) => report(stage, settled(outcome)),
  finish: outcome => report('operation', settled(outcome)),
};

/** Reuse the genuine screen's phase hooks with fixed tokens only, never a target or error. */
export function processRecordingDeletionProbe():
  RecordingDeletionTimingProbe | undefined {
  return sink() ? processProbe : undefined;
}
