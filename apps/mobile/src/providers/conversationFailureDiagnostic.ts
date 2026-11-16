import { providerDiagnostic } from './diagnostics';

/** Diagnose the failed app boundary, not error messages, names supplied by providers, or stacks. */
export function reportConversationException(
  stage: 'conversation_dispatch' | 'conversation_run',
  error: unknown,
) {
  try {
    const outcome =
      error instanceof TypeError
        ? 'type_error'
        : error instanceof ReferenceError
          ? 'reference_error'
          : error instanceof RangeError
            ? 'range_error'
            : 'other';
    providerDiagnostic('rag', stage, outcome);
  } catch {
    // Opt-in diagnostics cannot replace the original outcome or cancellation.
  }
}
