function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function status(value: unknown, allowed: readonly string[]): string {
  return typeof value === 'string' && allowed.includes(value)
    ? value
    : 'unknown';
}

function count(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function counter(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

/** Failure messages cross the native broker as strings. Project only counts and
 * closed status values: never stringify probe results, requests, errors or replies.
 * Capture this before mock cleanup resets the native inventory.
 */
export function modelMockFailureDiagnostics(
  expected: number,
  dispatched: number,
  observation: { requests: readonly unknown[]; remainingReplies: unknown },
  result: unknown,
) {
  const probe = record(result);
  const terminals = [
    'notobserved',
    'answer',
    'insufficient',
    'unavailable',
    'no_evidence',
    'cancelled',
    'provider-unavailable',
    'probe-error',
  ];
  const responses = Array.isArray(probe.responses) ? probe.responses : [];
  const generations = Array.isArray(probe.diagnostics) ? probe.diagnostics : [];
  return {
    expected,
    dispatched,
    nativeRequests: observation.requests.length,
    remainingReplies: counter(observation.remainingReplies),
    probe: {
      availability: status(probe.availability, [
        'available',
        'unsupportedDevice',
        'modelNotReady',
        'notEnabled',
        'unavailable',
        'notobserved',
      ]),
      terminal: status(probe.terminal, terminals),
      outcome: status(record(probe.outcome).status, [
        'answer',
        'insufficient',
        'unavailable',
        'no_evidence',
      ]),
      retrieval: status(probe.retrieval, ['observed', 'notobserved']),
      requests: count(probe.requests),
      publications: count(probe.publications),
      // Bounded status projections retain response classes without URLs, headers or bodies.
      httpStatuses: [
        ...new Set(
          responses
            .map(value => record(value).status)
            .filter(
              (value): value is number =>
                typeof value === 'number' &&
                Number.isInteger(value) &&
                value >= 100 &&
                value <= 599,
            ),
        ),
      ].slice(0, 8),
      generationCalls: count(probe.diagnostics),
      generationStatuses: generations
        .slice(0, 8)
        .map(value =>
          status(record(value).status, [
            'pending',
            'response',
            'provider-error',
            'thrown',
          ]),
        ),
      parentAborted:
        typeof probe.parentAborted === 'boolean' ? probe.parentAborted : null,
    },
  };
}
