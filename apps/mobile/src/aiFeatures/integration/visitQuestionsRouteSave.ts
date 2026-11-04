import { DEFAULT_MULTI_AGENT_BUDGET } from '@orot/agent-runtime';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { Appointment } from '@orot/domain';
import {
  localEvidenceFingerprint,
  visitQuestionCitationKey,
} from '../../agent/visitQuestions/evidence';
import type {
  VisitQuestionCandidate,
  VisitQuestionEvidenceItem,
} from '../../agent/visitQuestions/taskContract';
import type { VisitQuestionEvidenceMetadata } from '../../agent/visitQuestions/evidence';
import type {
  EvidenceCaveat,
  NextVisitQuestion,
  SaveReviewedQuestionsResult,
} from '../../nextVisitQuestions/types';

export interface VisitQuestionRouteSaveInput {
  readonly appointment: Appointment;
  readonly questions: readonly NextVisitQuestion<VisitQuestionEvidenceItem>[];
  readonly caveats: readonly EvidenceCaveat[];
  readonly resolveSource: (
    reference: EvidenceReference,
  ) => EvidenceReference | undefined;
  readonly validateGeneratedArtifact?: (
    reference: VisitQuestionEvidenceItem,
    signal: AbortSignal,
  ) => Promise<boolean>;
}

export interface VisitQuestionRouteSaveResult extends SaveReviewedQuestionsResult<VisitQuestionEvidenceItem> {
  readonly validateSource: (
    reference: VisitQuestionEvidenceItem,
    signal: AbortSignal,
  ) => Promise<boolean>;
}

type VisitQuestionContextModule = Pick<
  typeof import('../../agent/visitQuestions/localContext'),
  'prepareUpcomingVisitQuestionContext'
>;
type VisitQuestionContextLoader = () => Promise<VisitQuestionContextModule>;

function generatedArtifactSource(
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

function freshCitation(
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

export async function saveVisitQuestionRoute(
  input: VisitQuestionRouteSaveInput,
  loadContext: VisitQuestionContextLoader = () =>
    import('../../agent/visitQuestions/localContext'),
): Promise<VisitQuestionRouteSaveResult> {
  // Keep local context loading lazy in production while tests supply synthetic records.
  const { prepareUpcomingVisitQuestionContext } = await loadContext();
  const generatedAliases = new Map<string, VisitQuestionEvidenceItem>();
  const context = await prepareUpcomingVisitQuestionContext({
    now: new Date().toISOString(),
    maxEvidenceItems: DEFAULT_MULTI_AGENT_BUDGET.maxEvidenceItems,
    validateGeneratedArtifact: async citation => {
      const controller = new AbortController();
      return Boolean(
        input.validateGeneratedArtifact &&
        (await input.validateGeneratedArtifact(
          generatedAliases.get(visitQuestionCitationKey(citation)) ?? citation,
          controller.signal,
        )),
      );
    },
  });
  if (
    context.status !== 'ready' ||
    context.appointment.id !== input.appointment.id ||
    localEvidenceFingerprint(context.appointment) !==
      localEvidenceFingerprint(input.appointment)
  ) {
    throw new Error('The current appointment changed before save.');
  }

  // A restored review must still match both source and span revisions before refreshing cached rows.
  const cache = new Map<string, VisitQuestionEvidenceItem>();
  const reviewed: VisitQuestionCandidate[] = [];
  for (const question of input.questions) {
    const citations: VisitQuestionEvidenceItem[] = [];
    const generatedArtifactContext: VisitQuestionEvidenceItem[] = [];
    const inputs = [
      ...question.citations.map(citation => ({ citation, context: false })),
      ...(question.generatedArtifactContext ?? []).map(citation => ({
        citation,
        context: true,
      })),
    ];
    for (const { citation, context: isContext } of inputs) {
      if (isContext && citation.sourceKind !== 'generated_artifact')
        throw new Error('Generated context must reference retained artifacts.');
      if (
        citation.sourceKind === 'external_medical' ||
        (citation.sourceKind === 'generated_artifact' &&
          !input.validateGeneratedArtifact)
      )
        throw new Error(
          'Visit questions can only cite current local or retained generated evidence.',
        );
      const resolved = input.resolveSource(citation);
      const key = resolved
        ? [
            resolved.sourceKind,
            resolved.sourceId,
            resolved.sourceRevision,
            resolved.evidenceId,
            resolved.evidenceRevision,
          ].join('\u0000')
        : visitQuestionCitationKey(citation);
      let current =
        cache.get(key) ??
        freshCitation(context.evidence.batch.items, citation, resolved);
      if (citation.sourceKind === 'generated_artifact') {
        const durable = resolved
          ? { ...resolved, content: citation.content }
          : citation;
        const source = generatedArtifactSource(durable);
        if (
          !input.validateGeneratedArtifact ||
          !(await input.validateGeneratedArtifact(
            citation,
            new AbortController().signal,
          ))
        )
          throw new Error(
            'The generated artifact changed or is no longer available.',
          );
        current = durable;
        // The registry validates the review alias; persistence requires the durable identity.
        generatedAliases.set(visitQuestionCitationKey(current), citation);
        if (!(context.evidence.metadataByCitation instanceof Map))
          throw new Error(
            'The evidence context cannot retain generated sources.',
          );
        context.evidence.metadataByCitation.set(
          visitQuestionCitationKey(current),
          {
            sourceRecordIds: [],
            sourceRecordRevisions: [],
            sourceDates: [],
            generatedArtifactSource: source,
          },
        );
        cache.set(key, current);
        (isContext ? generatedArtifactContext : citations).push(current);
        continue;
      }
      if (!current) {
        if (citation.sourceKind === 'personal_record') {
          const reloaded = await context.reloadPersonalEvidence(
            resolved ?? citation,
          );
          current = freshCitation(
            reloaded ? [reloaded] : [],
            citation,
            resolved,
          );
        } else {
          const searched = await context.searchEvidence(
            citation.content,
            DEFAULT_MULTI_AGENT_BUDGET.maxEvidenceItems,
            citation.sourceKind,
          );
          current = freshCitation(searched.batch.items, citation, resolved);
        }
      }
      if (!current)
        throw new Error('A cited source changed or is no longer available.');
      cache.set(key, current);
      citations.push(current);
    }
    reviewed.push({
      ...(question.kind ? { kind: question.kind } : {}),
      ...(question.legacySource ? { legacySource: question.legacySource } : {}),
      questionText: question.questionText,
      rationale: question.rationale,
      priority: question.priority,
      citations,
      ...(generatedArtifactContext.length ? { generatedArtifactContext } : {}),
    });
  }

  const saved = await context.saveReviewedQuestions(reviewed);
  return {
    questions: reviewed.map((question, index) =>
      question.legacySource
        ? {
            ...question,
            legacySource: {
              id: saved.questions[index]!.id,
              revision: localEvidenceFingerprint(saved.questions[index]),
            },
          }
        : question,
    ),
    caveats: input.caveats,
    memoryStatus: saved.memoryStatus,
    validateSource: async (reference, signal) =>
      !signal.aborted && (await context.revalidateEvidence([reference])),
  };
}
