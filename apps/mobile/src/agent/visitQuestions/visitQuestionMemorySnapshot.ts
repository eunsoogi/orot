import type { VisitQuestionCreate } from '@orot/domain';
import { healthPeriodDependencyId } from '../../storage/healthPeriodDependencies';

/** Both the explicit review writer and historical reader bind to the same
 * committed question identities, saved order and verbatim text. */
export function visitQuestionMemorySnapshot(
  questions: readonly VisitQuestionCreate[],
) {
  const sourceIds = [
    ...new Set(
      questions.flatMap(question => [
        question.id,
        question.appointmentId,
        ...question.provenance.sourceRecordIds,
        ...(question.generatedArtifactSources ?? []).map(
          source => `generated-artifact:${source.kind}:${source.id}`,
        ),
        ...(question.healthContextSources ?? []).map(healthPeriodDependencyId),
      ]),
    ),
  ];
  const byDate = new Map<string, VisitQuestionCreate[]>();
  for (const question of questions) {
    const sameDate = byDate.get(question.effectiveAt) ?? [];
    sameDate.push(question);
    byDate.set(question.effectiveAt, sameDate);
  }
  const text = [...byDate]
    .flatMap(([date, group]) => [
      `사용자가 ${date} 예약을 위해 검토한 질문:`,
      ...group.map(
        (question, index) => `${index + 1}. ${question.questionText}`,
      ),
    ])
    .join('\n');
  return { sourceIds, text };
}
