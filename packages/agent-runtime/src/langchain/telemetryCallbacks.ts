import type { Callbacks } from '@langchain/core/callbacks/manager';
import { v4 as createUuid } from '@langchain/core/utils/uuid';
import { createExternalTelemetrySink, type TelemetrySink } from '@orot/model-runtime';

export const OROT_TELEMETRY_EVENT_NAME = 'orot_telemetry';

export interface CallbackTelemetryOptions {
  readonly enabled?: boolean;
  readonly callbacks?: Callbacks;
}

/** Bridge only sanitized telemetry to explicitly supplied handlers, never callback tags or metadata. */
export function createCallbackTelemetrySink(options: CallbackTelemetryOptions = {}): TelemetrySink {
  return createExternalTelemetrySink({
    enabled: options.enabled === true,
    sink: {
      record(event) {
        const handlers = options.callbacks
          ? Array.isArray(options.callbacks)
            ? options.callbacks
            : options.callbacks.handlers
          : [];
        const runId = createUuid();
        for (const handler of handlers) {
          try {
            if ('ignoreCustomEvent' in handler && handler.ignoreCustomEvent) continue;
            // Direct delivery avoids CallbackManager's caller-provided tags and metadata.
            Promise.resolve(
              handler.handleCustomEvent?.(OROT_TELEMETRY_EVENT_NAME, event, runId),
            ).catch(() => undefined);
          } catch {
            // External handlers are best-effort and cannot alter the model call.
          }
        }
      },
    },
  });
}
