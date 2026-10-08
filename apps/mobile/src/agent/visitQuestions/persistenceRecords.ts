import type { AgentMemoryService } from '@orot/agent-memory';
import { VisitQuestionCreateSchema } from '@orot/domain';
import type { Appointment, VisitQuestionCreate } from '@orot/domain';
import { visitQuestionCitationKey } from './evidence';
import type { VisitQuestionEvidenceCollection } from './evidenceCollection';
import type {
  VisitQuestionCandidate,
  VisitQuestionEvidenceItem,
} from './taskContract';

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function createReviewedVisitQuestionRecord(input: {
  readonly appointment: Appointment;
  readonly appointmentId: string;
  readonly question: VisitQuestionCandidate;
  readonly position: number;
  readonly now: string;
  readonly metadataByCitation: VisitQuestionEvidenceCollection['metadataByCitation'];
}): VisitQuestionCreate {
  const sourceRecordIds = uniqueValues([
    input.appointmentId,
    ...input.question.citations.flatMap(citation => {
      const metadata = input.metadataByCitation.get(
        visitQuestionCitationKey(citation),
      );
      if (!metadata)
        throw new Error('The reviewed evidence reference is unavailable.');
      return metadata.sourceRecordIds;
    }),
  ]);
  const evidenceSpanIds = uniqueValues(
    input.question.citations.flatMap(citation => {
      const metadata = input.metadataByCitation.get(
        visitQuestionCitationKey(citation),
      );
      return metadata?.evidenceSpanId ? [metadata.evidenceSpanId] : [];
    }),
  );

  // The local app has no user account ID; this marks an explicit on-device human review.
  return VisitQuestionCreateSchema.parse({
    id: `visit-question:${input.appointmentId}:${input.position}`,
    effectiveAt: input.appointment.effectiveAt,
    recordedAt: input.now,
    ingestedAt: input.now,
    provenance: { origin: 'derived', sourceRecordIds },
    reviewState: {
      status: 'reviewed',
      reviewerId: 'local-user',
      reviewedAt: input.now,
    },
    questionText: input.question.questionText.trim(),
    rationale: input.question.rationale.trim(),
    priority: input.question.priority,
    evidenceSpanIds,
    appointmentId: input.appointmentId,
    position: input.position,
  });
}

export async function saveReviewedVisitQuestionMemory(
  memory: Pick<AgentMemoryService, 'remember'> | undefined,
  appointment: Appointment,
  appointmentId: string,
  questions: readonly VisitQuestionCreate[],
  citations: readonly VisitQuestionEvidenceItem[],
  metadataByCitation: VisitQuestionEvidenceCollection['metadataByCitation'],
): Promise<'saved' | 'retry_required'> {
  if (!memory) return 'retry_required';
  const sourceIds = uniqueValues(
    questions.flatMap(question => [
      question.appointmentId,
      ...question.provenance.sourceRecordIds,
    ]),
  );
  const sourceDates = new Map<string, string>([
    [appointmentId, appointment.effectiveAt],
  ]);
  for (const citation of citations) {
    const metadata = metadataByCitation.get(visitQuestionCitationKey(citation));
    for (const sourceDate of metadata?.sourceDates ?? []) {
      if (sourceIds.includes(sourceDate.sourceId))
        sourceDates.set(sourceDate.sourceId, sourceDate.date);
    }
  }

  try {
    await memory.remember({
      memoryKey: `visit-question-review:${appointmentId}`,
      kind: 'reviewed_interaction',
      importance: 0.75,
      text: [
        `사용자가 ${appointment.effectiveAt} 예약을 위해 검토한 질문:`,
        ...questions.map(
          (question, index) => `${index + 1}. ${question.questionText}`,
        ),
      ].join('\n'),
      provenance: {
        sourceIds,
        sourceDates: [...sourceDates].map(([sourceId, date]) => ({
          sourceId,
          date,
        })),
        reviewState: 'human_reviewed',
      },
    });
    return 'saved';
  } catch {
    // The reviewed list is already durable; the stable memory key makes a later retry safe.
    return 'retry_required';
  }
}
