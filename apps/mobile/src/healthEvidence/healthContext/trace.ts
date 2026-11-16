export type HealthContextPhase =
  | 'preparation'
  | 'generation'
  | 'scheduler'
  | 'transaction_wait'
  | 'calendar'
  | 'quantities'
  | 'medications'
  | 'sleep'
  | 'symptoms';
export type HealthContextTrace = (
  phase: HealthContextPhase,
  status: 'started' | 'completed',
) => void;

/** Optional diagnostics carry closed phase tokens only, never dates, counts, record values or identifiers. */
export async function traceHealthContext<T>(
  trace: HealthContextTrace | undefined,
  phase: HealthContextPhase,
  operation: () => Promise<T>,
): Promise<T> {
  trace?.(phase, 'started');
  const result = await operation();
  trace?.(phase, 'completed');
  return result;
}

/** A same-turn probe distinguishes event-loop scheduling from transaction callback entry. */
export function traceHealthContextScheduler(
  trace?: HealthContextTrace,
): () => void {
  if (!trace) return () => {};
  let active = true;
  const report = (status: 'started' | 'completed') => {
    try {
      trace('scheduler', status);
    } catch {
      /* Optional diagnostics cannot affect a read. */
    }
  };
  report('started');
  // Do not await or gate the database: this measures scheduling without changing ordering.
  const handle = setImmediate(() => {
    if (active) report('completed');
    active = false;
  });
  // No completion token means admission won the race; never retain a probe beyond its read.
  return () => {
    active = false;
    clearImmediate(handle);
  };
}
