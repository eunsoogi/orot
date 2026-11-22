import {
  VisitQuestionCreateSchema,
  type VisitQuestionCreate,
} from '@orot/domain';
import type { AgentMemoryHit } from '@orot/agent-memory';
import type { SqlExecutor } from '@orot/storage';
import { visitQuestionMemorySnapshot } from '../agent/visitQuestions/visitQuestionMemorySnapshot';

/** An old reviewed flag or quarantine digest alone is not an owner receipt.
 * Match the entire retained projection against the existing on-device review
 * transaction. Do not open or attest any current evidence or source bodies. */
export async function ownsHistoricalVisitMemory(
  tx: SqlExecutor,
  memory: Omit<AgentMemoryHit, 'score'>,
) {
  const key = /^visit-question-review:(.+)$/u.exec(memory.memoryKey ?? '')?.[1];
  const refs = memory.provenance.sourceReferences;
  if (
    !key ||
    key.trim() !== key ||
    !refs?.length ||
    refs.some(ref => ref.kind !== 'visit_question' || ref.id.trim() !== ref.id)
  )
    return false;
  const ids = refs.map(ref => ref.id);
  if (new Set(ids).size !== ids.length) return false;
  const { rows } = await tx.execute(
    "SELECT id,payload_json FROM visit_questions WHERE json_extract(payload_json, '$.appointmentId')=?",
    [key],
  );
  if (rows.length !== ids.length) return false;
  const reviewed: VisitQuestionCreate[] = [];
  for (const row of rows) {
    if (typeof row.payload_json !== 'string') return false;
    let payload: unknown;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      return false;
    }
    const parsed = VisitQuestionCreateSchema.safeParse(payload);
    if (!parsed.success) return false;
    const question = parsed.data;
    if (
      question.id !== row.id ||
      !ids.includes(question.id) ||
      question.appointmentId !== key ||
      question.provenance.origin !== 'derived' ||
      question.reviewState.status !== 'reviewed' ||
      question.reviewState.reviewerId !== 'local-user' ||
      Date.parse(question.reviewState.reviewedAt) > memory.createdAt
    )
      return false;
    reviewed.push(question);
  }
  if (new Set(reviewed.map(question => question.position)).size !== ids.length)
    return false;
  reviewed.sort((a, b) => a.position - b.position);
  const owned = visitQuestionMemorySnapshot(reviewed);
  return (
    owned.text === memory.text &&
    owned.sourceIds.length === memory.provenance.sourceIds.length &&
    owned.sourceIds.every(id => memory.provenance.sourceIds.includes(id))
  );
}
