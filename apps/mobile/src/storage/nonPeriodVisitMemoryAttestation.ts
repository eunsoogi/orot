import {
  projectDefaultSavedMemory,
  type PersistedMemoryRecord,
} from '@orot/agent-memory';
import {
  AppointmentSchema,
  VisitQuestionCreateSchema,
  type Appointment,
  type VisitQuestionCreate,
} from '@orot/domain';
import type { SqlExecutor } from '@orot/storage';
import { visitQuestionMemorySnapshot } from '../agent/visitQuestions/visitQuestionMemorySnapshot';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { reviewedMemoryRevision } from './agentMemoryPeriodAttestation';
import { memoryContentChangedPredicate } from './memoryContentChange';

type VisitReviewWitness = {
  readonly appointmentId: string;
  readonly appointmentRevision: string;
  readonly parents: readonly {
    readonly id: string;
    readonly revision: string;
  }[];
  readonly payload: string;
};
const witnesses = new WeakMap<object, VisitReviewWitness>();

function parentVersions(questions: readonly VisitQuestionCreate[]) {
  return questions.map(question => ({
    id: question.id,
    revision: fingerprint(question),
  }));
}

function memoryPayload(
  text: string,
  sourceIds: readonly string[],
  questionIds: readonly string[],
) {
  // Exact comparison for this ephemeral capability; no private text is retained by the receipt table.
  return JSON.stringify([text, [...sourceIds].sort(), [...questionIds].sort()]);
}

function supported(questions: readonly VisitQuestionCreate[]) {
  // Scope this receipt to generated-parent, non-period reviews. The existing
  // period attestation and source-free saves retain their own behavior.
  return (
    questions.length > 0 &&
    questions.length <= 5 &&
    questions.some(question => question.generatedArtifactSources?.length) &&
    questions.every(question => !question.healthContextSources?.length)
  );
}

/** Only the explicit Visit review writer issues this per-call capability.
 * It is not serialized into memory, vectors, provider metadata, or logs. */
export function createNonPeriodVisitMemoryWitness(
  appointment: Appointment,
  questions: readonly VisitQuestionCreate[],
): object | undefined {
  if (!supported(questions)) return undefined;
  const token = Object.freeze({});
  const { text, sourceIds } = visitQuestionMemorySnapshot(questions);
  witnesses.set(token, {
    appointmentId: appointment.id,
    appointmentRevision: fingerprint(appointment),
    parents: parentVersions(questions),
    payload: memoryPayload(
      text,
      sourceIds,
      questions.map(question => question.id),
    ),
  });
  return token;
}

/** Bind only the row staged by this explicit review's remember operation to
 * the exact still-current review bundle, within the same memory transaction. */
export async function attestNonPeriodVisitMemory(
  tx: SqlExecutor,
  record: PersistedMemoryRecord | null | undefined,
  token: unknown,
) {
  if (typeof token !== 'object' || !token) return;
  const witness = witnesses.get(token);
  if (!witness) return;
  witnesses.delete(token);
  if (!record) return; // An identical no-op or deduplication cannot stamp an earlier row.
  const memory = projectDefaultSavedMemory(record);
  const refs = memory?.provenance.sourceReferences;
  if (
    !memory ||
    memory.kind !== 'reviewed_interaction' ||
    memory.provenance.reviewState !== 'human_reviewed' ||
    memory.memoryKey !== `visit-question-review:${witness.appointmentId}` ||
    !refs?.length ||
    refs.some(ref => ref.kind !== 'visit_question') ||
    memoryPayload(
      memory.text,
      memory.provenance.sourceIds,
      refs.map(ref => ref.id),
    ) !== witness.payload
  )
    throw new Error(
      'The reviewed memory no longer matches the selected questions.',
    );

  const appointment = await tx.execute(
    'SELECT payload_json FROM appointments WHERE id=?',
    [witness.appointmentId],
  );
  const exactOwner = AppointmentSchema.safeParse(
    JSON.parse(String(appointment.rows[0]?.payload_json ?? 'null')),
  );
  if (
    !exactOwner.success ||
    fingerprint(exactOwner.data) !== witness.appointmentRevision
  )
    throw new Error('The reviewed appointment is no longer current.');

  const { rows } = await tx.execute(
    `SELECT id,payload_json FROM visit_questions
       WHERE json_extract(payload_json, '$.appointmentId')=? LIMIT 6`,
    [witness.appointmentId],
  );
  const reviewed = rows
    .map(row => {
      const value = VisitQuestionCreateSchema.safeParse(
        JSON.parse(String(row.payload_json)),
      );
      if (
        !value.success ||
        value.data.id !== row.id ||
        value.data.reviewState.status !== 'reviewed' ||
        value.data.reviewState.reviewerId !== 'local-user' ||
        value.data.provenance.origin !== 'derived'
      )
        throw new Error('The reviewed questions are no longer current.');
      return value.data;
    })
    .sort((a, b) => a.position - b.position);
  if (
    !supported(reviewed) ||
    JSON.stringify(parentVersions(reviewed)) !== JSON.stringify(witness.parents)
  )
    throw new Error('The reviewed questions are no longer current.');
  for (const { id, revision } of witness.parents) {
    const stamp = await tx.execute(
      "SELECT 1 FROM visit_period_policy WHERE question_id=? AND revision=? AND status='current'",
      [id, revision],
    );
    if (stamp.rows.length !== 1)
      throw new Error('The current explicit review is unavailable.');
  }
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS memory_non_period_visit_attestation(memory_id TEXT NOT NULL,revision TEXT NOT NULL,parents_json TEXT NOT NULL,PRIMARY KEY(memory_id,revision))',
  );
  await tx.execute(
    'CREATE TRIGGER IF NOT EXISTS memory_non_period_visit_attestation_removed AFTER DELETE ON agent_memory_records BEGIN DELETE FROM memory_non_period_visit_attestation WHERE memory_id=OLD.id; END',
  );
  // The durable witness binds the same identity fields as reviewedMemoryRevision,
  // not mutable index state. A later undo must not reauthorize a replaced row.
  await tx.execute(
    `CREATE TRIGGER IF NOT EXISTS memory_non_period_visit_attestation_replaced
      AFTER UPDATE ON agent_memory_records WHEN OLD.id IS NOT NEW.id
        OR json_extract(OLD.record_json, '$.id') IS NOT json_extract(NEW.record_json, '$.id')
        OR json_extract(OLD.record_json, '$.createdAt') IS NOT json_extract(NEW.record_json, '$.createdAt')
        OR ${memoryContentChangedPredicate()}
      BEGIN DELETE FROM memory_non_period_visit_attestation WHERE memory_id=OLD.id; END`,
  );
  await tx.execute(
    'INSERT OR IGNORE INTO memory_non_period_visit_attestation VALUES (?,?,?)',
    [
      record.id,
      reviewedMemoryRevision(record),
      JSON.stringify(witness.parents),
    ],
  );
}

export async function hasExactNonPeriodVisitMemoryAttestation(
  tx: SqlExecutor,
  id: string,
  revision: string,
  questions: readonly VisitQuestionCreate[],
) {
  if (!supported(questions)) return false;
  const table = await tx.execute(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_non_period_visit_attestation'",
  );
  if (!table.rows.length) return false;
  const rows = await tx.execute(
    'SELECT 1 FROM memory_non_period_visit_attestation WHERE memory_id=? AND revision=? AND parents_json=?',
    [id, revision, JSON.stringify(parentVersions(questions))],
  );
  return rows.rows.length === 1;
}
