export type HealthContextPhase =
  | 'preparation'
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
