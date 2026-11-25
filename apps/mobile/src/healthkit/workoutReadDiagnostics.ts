import { NativeModules } from 'react-native';

type Route = 'overview' | 'records' | 'shared';
type Stage =
  | 'route'
  | 'protection'
  | 'database'
  | 'epoch'
  | 'cohort'
  | 'reproof'
  | 'bridge';
type Outcome =
  | 'started'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'missing'
  | 'empty';

type Sink = {
  enabled?: boolean;
  report(feature: string, stage: string, outcome: string): void;
};

/** Exercise the real app route without exporting owner identities, values, time windows,
 * or native errors. Native independently validates this closed vocabulary. */
export function workoutReadDiagnostics(route: Route) {
  function optInSink() {
    try {
      const sink = NativeModules.OrotProviderDiagnostics as Sink | undefined;
      return sink?.enabled === true ? sink : undefined;
    } catch {
      return undefined;
    }
  }
  const report = (stage: Stage, outcome: Outcome) => {
    try {
      optInSink()?.report('workout_period', route + '_' + stage, outcome);
    } catch {
      // An opt-in observation never changes admission, read, or publication.
    }
  };
  return {
    report,
    observe<T>(
      stage: Stage,
      attempt: () => Promise<T>,
      current = () => true,
    ): Promise<T> {
      if (!optInSink()) return attempt();
      report(stage, 'started');
      const finish = (result: T | undefined) => {
        try {
          report(
            stage,
            !current()
              ? 'cancelled'
              : result == null || result === false
                ? 'failed'
                : 'completed',
          );
        } catch {
          // Even failure of an optional classification has no effect.
        }
      };
      try {
        return attempt().then(
          result => {
            finish(result);
            return result;
          },
          (error: unknown) => {
            finish(undefined);
            throw error;
          },
        );
      } catch (error) {
        finish(undefined);
        throw error;
      }
    },
  };
}
