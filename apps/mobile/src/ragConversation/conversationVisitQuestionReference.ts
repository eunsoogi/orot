import type { EvidenceReference } from '@orot/agent-runtime';
import type { NextVisitQuestion } from '../nextVisitQuestions/types';
import type { VisitQuestionEvidenceItem } from '../agent/visitQuestions/taskContract';

/** A retained turn refers to its visit; the prepared questions remain in their own repository. */
export interface ConversationVisitQuestionReference {
  readonly appointmentId: string;
  readonly source: EvidenceReference;
  readonly candidates: readonly NextVisitQuestion<VisitQuestionEvidenceItem>[];
}

/** Stored turn metadata is untrusted and must identify an exact, source-backed appointment. */
export function parseConversationVisitQuestionReference(
  value: unknown,
): ConversationVisitQuestionReference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    Object.keys(item).some(
      key =>
        key !== 'appointmentId' && key !== 'source' && key !== 'candidates',
    ) ||
    typeof item.appointmentId !== 'string' ||
    !item.appointmentId ||
    item.appointmentId.length > 256 ||
    item.appointmentId.trim() !== item.appointmentId ||
    !item.source ||
    typeof item.source !== 'object' ||
    Array.isArray(item.source)
  )
    return null;
  if (!Array.isArray(item.candidates) || item.candidates.length > 5)
    return null;
  const ids = new Set<string>();
  for (const candidate of item.candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
      return null;
    const question = candidate as Record<string, unknown>;
    const identity = question.identity as Record<string, unknown> | null;
    if (
      Object.keys(question).some(
        key =>
          ![
            'identity',
            'kind',
            'questionText',
            'rationale',
            'priority',
            'citations',
            'generatedArtifactContext',
          ].includes(key),
      ) ||
      !identity ||
      typeof identity !== 'object' ||
      Array.isArray(identity) ||
      Object.keys(identity).some(key => key !== 'id') ||
      typeof identity.id !== 'string' ||
      !identity.id ||
      identity.id.length > 256 ||
      identity.id.trim() !== identity.id ||
      ids.has(identity.id) ||
      typeof question.questionText !== 'string' ||
      !question.questionText.trim() ||
      question.questionText.length > 2000 ||
      typeof question.rationale !== 'string' ||
      question.rationale.length > 2000 ||
      !['routine', 'important'].includes(String(question.priority)) ||
      (question.kind !== undefined &&
        !['confirmed_fact', 'clarification'].includes(String(question.kind)))
    )
      return null;
    ids.add(identity.id);
    for (const refs of [
      question.citations,
      question.generatedArtifactContext ?? [],
    ]) {
      if (
        !Array.isArray(refs) ||
        refs.length > 24 ||
        refs.some(
          ref =>
            !ref ||
            typeof ref !== 'object' ||
            Array.isArray(ref) ||
            typeof ref.content !== 'string' ||
            ref.content.length > 8000,
        )
      )
        return null;
    }
  }
  const source = item.source as Record<string, unknown>;
  if (
    source.sourceKind !== 'personal_record' ||
    source.sourceId !== item.appointmentId ||
    source.evidenceId !== item.appointmentId
  )
    return null;
  return item as unknown as ConversationVisitQuestionReference;
}
