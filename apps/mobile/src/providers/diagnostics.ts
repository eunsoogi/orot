import { NativeModules } from 'react-native';

import type { Feature, Stage, Outcome } from './diagnosticTypes';

/** The native opt-in sink independently allowlists every token. Never pass content or errors. */
export function providerDiagnostic(
  feature: Feature,
  stage: Stage,
  outcome: Outcome,
) {
  NativeModules.OrotProviderDiagnostics?.report(feature, stage, outcome);
}

/** Exception classes are closed codes; messages and stacks can contain private task content. */
export function reportProviderException(feature: Feature, error: unknown) {
  const name = error instanceof Error ? error.name : '';
  providerDiagnostic(
    feature,
    'provider_error',
    name === 'TypeError'
      ? 'type_error'
      : name === 'ReferenceError'
        ? 'reference_error'
        : name === 'RangeError'
          ? 'range_error'
          : 'other',
  );
}

export async function withProviderStage<T>(
  feature: Feature,
  stage: Stage,
  work: () => Promise<T>,
): Promise<T> {
  providerDiagnostic(feature, stage, 'started');
  try {
    const result = await work();
    providerDiagnostic(feature, stage, 'completed');
    return result;
  } catch (error) {
    providerDiagnostic(feature, stage, 'failed');
    throw error;
  }
}

/** Maps only known workflow states, never free-form provider messages or validation reasons. */
export function reportWorkflowOutcome(
  feature: Feature,
  status: string,
  providerErrorCode?: string,
  validationReason?: string,
) {
  if (status === 'invalid_output') {
    const known: Readonly<Record<string, Outcome>> = {
      'The task responder returned malformed structured output.': 'task_json',
      'The task requires a source-kind lookup before its final answer.':
        'task_required_source',
      'The task responder returned an invalid envelope: json.':
        'task_envelope_json',
      'The task responder returned an invalid envelope: object.':
        'task_envelope_object',
      'The task responder returned an invalid envelope: type.':
        'task_envelope_type',
      'The task responder returned an invalid envelope: citations.':
        'task_envelope_citations',
      'The task responder returned an invalid envelope: value.':
        'task_envelope_value',
      'The task responder returned an invalid envelope: fields.':
        'task_envelope_fields',
      'The task responder returned an invalid envelope: need.':
        'task_envelope_need',
      'The result cited evidence outside the current validated evidence set.':
        'task_citations',
      'The task result did not pass local validation.': 'task_schema',
      'The selected model returned an incomplete or unsupported response.':
        'task_incomplete',
    };
    // Compare exact local reasons; never send a free-form reason to the native sink.
    providerDiagnostic(
      feature,
      'validation',
      validationReason && Object.hasOwn(known, validationReason)
        ? known[validationReason]!
        : 'other',
    );
  }
  switch (providerErrorCode) {
    case 'authentication_required':
    case 'credential_unavailable':
    case 'internal_error':
    case 'invalid_provider':
    case 'invalid_request':
    case 'provider_unavailable':
    case 'rate_limited':
    case 'safety_refusal':
    case 'unsupported_capability':
    case 'unsupported_input':
      providerDiagnostic(feature, 'provider_error', providerErrorCode);
      break;
  }
  switch (status) {
    case 'result':
    case 'invalid_output':
    case 'needs_clarification':
    case 'cancelled':
    case 'consent_required':
    case 'provider_unavailable':
    case 'budget_exhausted':
    case 'unavailable':
    case 'budget_exceeded':
    case 'stale_evidence':
      providerDiagnostic(feature, 'workflow', status);
      break;
    default:
      providerDiagnostic(feature, 'workflow', 'other');
  }
}
