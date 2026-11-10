import type { EvidenceReference } from '@orot/agent-runtime';
import { visitQuestionCitationKey } from '../../agent/visitQuestions/evidence';
import type { VisitQuestionEvidenceMetadata } from '../../agent/visitQuestions/evidence';
import type { VisitQuestionEvidenceItem } from '../../agent/visitQuestions/taskContract';

/** Preserve durable generated sources and compare the exact saved citation revisions. */
export function generatedArtifactSource(
  citation: VisitQuestionEvidenceItem,
): NonNullable<VisitQuestionEvidenceMetadata['generatedArtifactSource']> {
  const locator = citation.locator;
  const type =
    typeof locator === 'object' && locator !== null && !Array.isArray(locator)
      ? (locator as Readonly<Record<string, unknown>>).type
      : undefined;
  if (
    citation.sourceKind !== 'generated_artifact' ||
    (type !== 'symptom_summary' &&
      type !== 'disease_possibilities' &&
      type !== 'daily_report' &&
      type !== 'conversation_turn' &&
      type !== 'research_publication' &&
      type !== 'research_web_explanation') ||
    citation.sourceId !== citation.evidenceId ||
    citation.sourceRevision !== citation.evidenceRevision
  )
    throw new Error('The generated artifact parent is incomplete or invalid.');
  return {
    kind:
      type === 'research_publication' || type === 'research_web_explanation'
        ? 'generated_research'
        : type === 'conversation_turn'
          ? 'generated_conversation'
          : 'generated_summary',
    type,
    id: citation.sourceId,
    revision: citation.sourceRevision,
  };
}

export function freshCitation(
  items: readonly VisitQuestionEvidenceItem[],
  citation: VisitQuestionEvidenceItem,
  resolved: EvidenceReference | undefined,
) {
  return items.find(item =>
    resolved
      ? item.sourceKind === resolved.sourceKind &&
        item.sourceId === resolved.sourceId &&
        item.sourceRevision === resolved.sourceRevision &&
        item.evidenceId === resolved.evidenceId &&
        item.evidenceRevision === resolved.evidenceRevision
      : visitQuestionCitationKey(item) === visitQuestionCitationKey(citation),
  );
}
