import type { EncounterGraphOptions } from '@orot/agent-runtime';
import type { ReviewState } from './controller';

type GraphFailure = Parameters<
  NonNullable<EncounterGraphOptions['onDiagnostic']>
>[0];
type Stage =
  | GraphFailure['stage']
  | 'controller'
  | 'source_lookup'
  | 'transcript_list'
  | 'transcript_read'
  | 'provider_selection'
  | 'session_begin'
  | 'session_read'
  | 'checkpoint_lookup'
  | 'graph_setup'
  | 'session_readback'
  | 'approval_receipt'
  | 'record_count';
type Failure = { stage: Stage; category: GraphFailure['category'] };
export interface ReviewDiagnosticAttempt {
  stage(value: Stage): void;
  capture(value: Failure): void;
  unavailable(value: Stage): void;
  caught(error: unknown): void;
  settled(status: ReviewState['status']): void;
}
export interface ReviewDiagnosticSnapshot {
  attempt: number;
  phase: 'loading' | 'running' | 'saving';
  status: ReviewState['status'];
  recordCount: number | 'UNKNOWN';
  modelCalls: number;
  failure: Failure | { stage: 'UNKNOWN'; category: 'UNKNOWN' };
}

/** Only synthetic native entries opt in. No identifiers, content or thrown values enter the sink. */
export function createReviewDiagnostics(
  ownedSourceId: string,
  recordCount: () => Promise<number>,
  modelCalls: () => number,
  emit: (snapshot: ReviewDiagnosticSnapshot) => void = () => {},
) {
  let attempt = 0;
  let phase: ReviewDiagnosticSnapshot['phase'] = 'loading';
  let stage: Stage = 'controller';
  let failure: Failure | undefined;
  let latest: Promise<ReviewDiagnosticSnapshot> | undefined;
  let bound = false;
  const capture = (value: Failure) => {
    if (bound) failure ??= value;
  };
  return {
    current(): ReviewDiagnosticAttempt {
      const token = attempt;
      // A late completion from a disposed controller cannot label a later attempt.
      return {
        stage: value => {
          if (token === attempt) this.stage(value);
        },
        capture: value => {
          if (token === attempt) this.capture(value);
        },
        unavailable: value => {
          if (token === attempt) this.unavailable(value);
        },
        caught: error => {
          if (token === attempt) this.caught(error);
        },
        settled: status => {
          if (token === attempt) this.settled(status);
        },
      };
    },
    begin(value: typeof phase, sourceId: string) {
      bound = sourceId === ownedSourceId;
      attempt += 1;
      phase = value;
      stage = 'controller';
      failure = undefined;
      latest = undefined;
    },
    stage(value: Stage) {
      stage = value;
    },
    capture,
    unavailable(value: Stage) {
      capture({ stage: value, category: 'unavailable' });
    },
    caught(error: unknown) {
      capture({
        stage,
        category:
          error instanceof TypeError
            ? 'type_error'
            : error instanceof RangeError
              ? 'range_error'
              : error instanceof Error
                ? 'error'
                : 'UNKNOWN',
      });
    },
    settled(status: ReviewState['status']) {
      if (!bound) return;
      // Copy attempt state before the independent SQL read so later attempts cannot relabel it.
      const frozen = {
        attempt,
        phase,
        status,
        modelCalls: modelCalls(),
        failure: failure && { ...failure },
      };
      latest = (async (): Promise<ReviewDiagnosticSnapshot> => {
        let count: number | 'UNKNOWN' = 'UNKNOWN';
        try {
          count = await recordCount();
        } catch {
          /* Missing SQL evidence is never zero rows. */
        }
        const snapshot = {
          ...frozen,
          recordCount: count,
          failure:
            frozen.failure ??
            (count === 'UNKNOWN'
              ? { stage: 'record_count' as const, category: 'UNKNOWN' as const }
              : { stage: 'UNKNOWN' as const, category: 'UNKNOWN' as const }),
        };
        try {
          emit(snapshot);
        } catch {
          /* Diagnostics cannot replace the original result. */
        }
        return snapshot;
      })();
    },
    snapshot() {
      return latest;
    },
  };
}

export type ReviewDiagnostics = ReturnType<typeof createReviewDiagnostics>;
