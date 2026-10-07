import type {
  ProviderErrorCode,
  TelemetryEvent,
  TelemetryOperation,
  TelemetryOutcome,
  TelemetrySink,
} from './contracts';

const telemetryOperations = new Set<TelemetryOperation>([
  'embedding.embed',
  'language-model.generate',
  'language-model.stream',
  'transcription.stream',
  'transcription.transcribe',
]);

const telemetryOutcomes = new Set<TelemetryOutcome>(['cancelled', 'error', 'success']);

const providerErrorCodes = new Set<ProviderErrorCode>([
  'authentication_required',
  'credential_unavailable',
  'duplicate_provider',
  'internal_error',
  'invalid_provider',
  'invalid_request',
  'provider_unavailable',
  'rate_limited',
  'unsupported_capability',
  'unsupported_input',
]);

const telemetryFields = new Set(['durationMs', 'errorCode', 'operation', 'outcome']);

/** Drops events with any field outside the public metadata contract before an external handoff. */
export function sanitizeTelemetryEvent(value: unknown): TelemetryEvent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;

    const record = value as Record<string, unknown>;
    if (Object.keys(record).some((key) => !telemetryFields.has(key))) return undefined;

    const operation = record.operation;
    const outcome = record.outcome;
    const durationMs = record.durationMs;
    if (
      typeof operation !== 'string' ||
      !telemetryOperations.has(operation as TelemetryOperation) ||
      typeof outcome !== 'string' ||
      !telemetryOutcomes.has(outcome as TelemetryOutcome) ||
      typeof durationMs !== 'number' ||
      !Number.isFinite(durationMs) ||
      durationMs < 0
    ) {
      return undefined;
    }

    const event: TelemetryEvent = {
      operation: operation as TelemetryOperation,
      outcome: outcome as TelemetryOutcome,
      durationMs,
    };
    if (Object.prototype.hasOwnProperty.call(record, 'errorCode')) {
      const errorCode = record.errorCode;
      if (
        outcome !== 'error' ||
        typeof errorCode !== 'string' ||
        !providerErrorCodes.has(errorCode as ProviderErrorCode)
      ) {
        return undefined;
      }
      return { ...event, errorCode: errorCode as ProviderErrorCode };
    }
    return event;
  } catch {
    // Malformed event objects must not trigger a fallback that forwards the original value.
    return undefined;
  }
}

export interface ExternalTelemetryOptions {
  readonly enabled?: boolean;
  readonly sink?: TelemetrySink;
}

/** External telemetry is opt-in; malformed or enriched events are rejected without logging them. */
export function createExternalTelemetrySink(options: ExternalTelemetryOptions = {}): TelemetrySink {
  const target = options.enabled === true ? options.sink : undefined;
  return {
    record(value) {
      if (!target) return;
      const event = sanitizeTelemetryEvent(value);
      if (!event) return;

      try {
        const result = target.record(event);
        if (result && typeof result.then === 'function') {
          Promise.resolve(result).catch(() => undefined);
        }
      } catch {
        // Telemetry failure never changes the inference result or emits payload-bearing diagnostics.
      }
    },
  };
}
