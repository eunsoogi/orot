import { NativeModules } from 'react-native';

type Stage = 'bridge_packet' | 'sidecar';
type Outcome = {
  bridge_packet: 'unavailable' | 'authorized' | 'authority_lost';
  sidecar: 'committed' | 'authority_lost' | 'failed';
};

/** The existing opt-in native sink independently validates these fixed tokens. */
export function traceVoiceCaptionClose<S extends Stage>(
  stage: S,
  outcome: Outcome[S],
) {
  try {
    NativeModules.OrotProviderDiagnostics?.report(
      'voice_caption',
      stage,
      outcome,
    );
  } catch {
    // Observability must not change graceful close or protected storage results.
  }
}
