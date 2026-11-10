import type { EvidenceReference } from '@orot/agent-runtime';
import type { DisplayMessage } from './ConversationMessage';
import type { RagConversationOutcome } from './outcome';
import { compoundEvidenceReferences } from '../aiFeatures/integration/compoundEvidenceReferences';

/** True marks a derived or opaque source that cannot be narrowed to concrete record IDs. */
export type HealthSourceDependencies = readonly string[] | true;

export function healthSourceDependencies(
  references: readonly EvidenceReference[],
): HealthSourceDependencies {
  const ids = new Set<string>();
  for (const reference of references) {
    if (reference.sourceKind === 'external_medical') continue;
    const members = compoundEvidenceReferences(reference);
    if (!members) return true;
    for (const member of members) {
      const raw = member.locator;
      const locator =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : undefined;
      if (
        member.sourceKind !== 'personal_record' ||
        !locator ||
        (locator.kind !== 'local_record' &&
          locator.kind !== 'structured_record') ||
        typeof locator.recordKind !== 'string' ||
        typeof locator.recordId !== 'string'
      )
        return true;
      if (
        !['health_observation', 'dose_event', 'medication_definition'].includes(
          locator.recordKind,
        )
      )
        continue;
      ids.add(locator.recordId);
      ids.add(member.sourceId);
      if (Array.isArray(locator.sourceRecordIds))
        for (const id of locator.sourceRecordIds)
          if (typeof id === 'string') ids.add(id);
    }
  }
  return [...ids];
}

function matchesDeletion(
  dependencies: HealthSourceDependencies,
  deletedIds?: ReadonlySet<string>,
): boolean {
  return (
    dependencies === true ||
    dependencies.some(id => !deletedIds || deletedIds.has(id))
  );
}

export function answerUsesDeletedHealthEvidence(
  answer: Extract<RagConversationOutcome, { status: 'answer' }>,
  deletedIds?: ReadonlySet<string>,
): boolean {
  return Boolean(
    answer.healthSummary ||
    answer.visitQuestions ||
    matchesDeletion(
      answer.healthSources ?? healthSourceDependencies(answer.citations),
      deletedIds,
    ),
  );
}

/** Discard affected prose and source links without dropping independent turns or user input. */
export function filterHealthDerivedMessages(
  messages: readonly DisplayMessage[],
  deletedIds?: ReadonlySet<string>,
) {
  return messages.flatMap(message => {
    if (message.role !== 'assistant') return [message];
    const tools = message.toolEvents?.filter(
      event => event.inputSummary.sourceKind === 'external_medical',
    );
    const affected =
      message.incomplete ||
      message.healthSummary ||
      message.visitQuestions ||
      matchesDeletion(
        message.healthSources ??
          healthSourceDependencies(message.citations ?? []),
        deletedIds,
      );
    if (!affected)
      return [
        tools?.length === message.toolEvents?.length
          ? message
          : { ...message, toolEvents: tools },
      ];
    // Visit discovery revalidates the durable record independently of this answer body.
    return message.visitQuestions || message.visitQuestionsUnavailable
      ? [
          {
            id: message.id,
            role: 'assistant' as const,
            content: '',
            incomplete: true,
            visitQuestionsUnavailable: true,
          },
        ]
      : [];
  });
}
