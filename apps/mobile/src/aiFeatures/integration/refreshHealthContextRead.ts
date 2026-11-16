import type { HealthContextReader } from '../../healthEvidence/healthContext/reader';
import type { HealthContextReport } from '../../healthEvidence/healthContext/types';
import {
  healthContextRevision,
  type HealthContextScope,
} from '../../healthEvidence/healthContext/scope';

/**
 * Before exposing a newly read local aggregate, allow one replacement from the
 * same fixed period/topic. No model, embedding, external search or mutation is
 * replayed. A deletion generation change never authorizes replacement.
 *
 * Returning the original on a second change preserves the ordinary runtime
 * freshness rejection; this is not permission to validate an obsolete alias.
 * The eventual model payload still passes its normal exact-payload consent.
 */
export async function refreshHealthContextRead(input: {
  readonly initial: HealthContextReport;
  readonly scope: HealthContextScope;
  readonly read: HealthContextReader;
  readonly signal: AbortSignal;
}): Promise<HealthContextReport> {
  const { initial, scope, read, signal } = input;
  const current = () => read(scope.window, [scope.topic], signal);
  const revision = (report: HealthContextReport) =>
    healthContextRevision(scope, report);
  if (signal.aborted) return initial;
  const latest = await current();
  if (
    signal.aborted ||
    latest.deletionGeneration !== initial.deletionGeneration
  )
    return initial;
  if (revision(latest) === revision(initial)) return initial;
  // The reread is still unexposed. Check it once, rather than chasing a moving
  // dataset or replacing input after it has influenced a model response.
  const confirmed = await current();
  return !signal.aborted &&
    confirmed.deletionGeneration === initial.deletionGeneration &&
    revision(confirmed) === revision(latest)
    ? latest
    : initial;
}
