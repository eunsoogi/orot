import {
  VisitQuestionCreateSchema,
  type VisitQuestionCreate,
} from '@orot/domain';
import type { AgentMemoryHit } from '@orot/agent-memory';
import type { SqlExecutor } from '@orot/storage';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { visitQuestionMemorySnapshot } from '../agent/visitQuestions/visitQuestionMemorySnapshot';

/** An old reviewed flag or quarantine digest alone is not an owner receipt.
 * Match the entire retained projection against the existing on-device review
 * transaction. Do not open or attest any current evidence or source bodies. */
export async function ownsHistoricalVisitMemory(
  tx: SqlExecutor,
  memory: Omit<AgentMemoryHit, 'score'>,
  memoryRevision: string,
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
  let requiresLaterReviewProof = false;
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
      question.reviewState.reviewerId !== 'local-user'
    )
      return false;
    requiresLaterReviewProof ||=
      Date.parse(question.reviewState.reviewedAt) > memory.createdAt;
    reviewed.push(question);
  }
  if (new Set(reviewed.map(question => question.position)).size !== ids.length)
    return false;
  reviewed.sort((a, b) => a.position - b.position);
  const owned = visitQuestionMemorySnapshot(reviewed);
  if (
    owned.text !== memory.text ||
    owned.sourceIds.length !== memory.provenance.sourceIds.length ||
    !owned.sourceIds.every(id => memory.provenance.sourceIds.includes(id))
  )
    return false;
  if (!requiresLaterReviewProof) return true;
  return hasExactReplacementAttestation(
    tx,
    memory.id,
    memoryRevision,
    reviewed,
  );
}

/** Replacement preserves the first creation time. Only the original atomic
 * memory write's full question revision set can prove a later review. This
 * never consults or reinstates current health-period policy. */
async function hasExactReplacementAttestation(
  tx: SqlExecutor,
  id: string,
  revision: string,
  questions: readonly VisitQuestionCreate[],
) {
  const tables = await tx.execute(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_period_attestation'",
  );
  if (!tables.rows.length) return false;
  const { rows } = await tx.execute(
    'SELECT parents_json FROM memory_period_attestation WHERE memory_id=? AND revision=?',
    [id, revision],
  );
  const serialized = rows[0]?.parents_json;
  if (typeof serialized !== 'string') return false;
  let parents: unknown;
  try {
    parents = JSON.parse(serialized);
  } catch {
    return false;
  }
  return (
    Array.isArray(parents) &&
    parents.length === questions.length &&
    questions.every((question, index) => {
      const parent = parents[index];
      return (
        parent &&
        typeof parent === 'object' &&
        parent.id === question.id &&
        parent.revision === fingerprint(question)
      );
    })
  );
}
