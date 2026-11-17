import type { GroundedRagAnswer } from './task';
import type { JsonValue } from '@orot/model-runtime';
import type {
  TaskResponderInput,
  TaskResultValidation,
} from '@orot/agent-runtime';
import { t } from '../i18n';
import { hasUnsupportedClinicalClaim } from './clinicalClaimValidation';
import { renderMixedEvidenceAnswer } from './mixedEvidenceAnswer';
import { requestsLiteratureExplanation } from './literatureIntent';
import { isObject } from './taskHistory';
import { observeConversationResultValidation } from './conversationResultDiagnostic';

/** Keep the existing result decision unchanged; observation cannot accept rejected output. */
export function validateConversationResult(
  value: JsonValue,
  input: TaskResponderInput,
) {
  return observeConversationResultValidation<GroundedRagAnswer>(value, () =>
    validate(value, input),
  );
}

function validate(
  value: JsonValue,
  input: TaskResponderInput,
): TaskResultValidation<GroundedRagAnswer> {
  if (
    !isObject(value) ||
    Object.keys(value).some(
      key =>
        key !== 'answer' &&
        key !== 'answerKind' &&
        key !== 'completion' &&
        key !== 'literature' &&
        key !== 'localClaims',
    ) ||
    // Historical checkpoints may supply the old label; validate but do not propagate it.
    ('completion' in value &&
      value.completion !== 'complete' &&
      value.completion !== 'partial') ||
    ('answerKind' in value &&
      value.answerKind !== 'grounded' &&
      value.answerKind !== 'conversation' &&
      value.answerKind !== 'prior_output') ||
    typeof value.answer !== 'string' ||
    (value.answer.trim().length === 0 &&
      !('literature' in value) &&
      !('localClaims' in value))
  ) {
    return {
      status: 'invalid',
      reason: 'The answer was empty or malformed.',
    } as const;
  }
  if (
    value.answerKind === 'conversation' &&
    requestsLiteratureExplanation(input.request)
  )
    return {
      status: 'needs_clarification',
      message: t('ragConversation.literature.requestEvidenceUnavailable'),
    } as const;
  if (value.answerKind !== 'conversation' && !input.evidence.items.length) {
    return {
      status: 'needs_clarification',
      message: 'No current evidence is available.',
    } as const;
  }
  if ('literature' in value || 'localClaims' in value) {
    const rendered = renderMixedEvidenceAnswer(
      value,
      input.evidence.items,
      input.request,
    );
    if (!rendered)
      return {
        status: 'needs_clarification',
        message: t('ragConversation.literature.statisticsSourceMismatch'),
      } as const;
    return {
      status: 'valid',
      value: {
        answer: rendered.answer,
        answerKind: 'grounded' as const,
        literatureReferences: rendered.literatureReferences,
        localReferences: rendered.localReferences,
      },
    } as const;
  }
  if (
    value.answerKind !== 'conversation' &&
    value.answerKind !== 'prior_output' &&
    (requestsLiteratureExplanation(input.request) ||
      input.evidence.items.some(item => item.sourceId === 'europe-pmc'))
  ) {
    // Plain prose cannot establish literature claims or a record-to-literature comparison.
    return {
      status: 'needs_clarification',
      message: t('ragConversation.literature.explanationSourceMismatch'),
    } as const;
  }
  // A model instruction alone cannot prevent a definitive diagnosis from reaching the user.
  if (hasUnsupportedClinicalClaim(value.answer, input)) {
    return {
      status: 'invalid',
      reason: 'The answer contained a definitive clinical claim.',
    } as const;
  }
  return {
    status: 'valid',
    value: {
      answer: value.answer,
      ...(value.answerKind === 'conversation' ||
      value.answerKind === 'grounded' ||
      value.answerKind === 'prior_output'
        ? { answerKind: value.answerKind }
        : {}),
    },
  } as const;
}
