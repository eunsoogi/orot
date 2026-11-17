import { visitGeneratedSourcesAvailable } from './visitGeneratedSourcePolicy';
import {
  appendVisitQuestionPeriod,
  setupVisitQuestionPeriods,
} from './visitQuestionPeriods';
import { VisitQuestionHealthContextSourceSchema } from '@orot/domain';
import { SavedVisitQuestionsReadError } from '../aiFeatures/integration/savedVisitQuestionCitation';
import type { SqlExecutor } from '@orot/storage';
import type { VisitQuestion } from '@orot/domain';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { readHealthContextReport } from '../healthEvidence/healthContext/reader';
import { healthContextRevision } from '../healthEvidence/healthContext/scope';

/** Policy belongs to the exact persisted question, never to a caller-supplied period source. */
async function setup(tx: SqlExecutor) {
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS visit_period_policy (question_id TEXT NOT NULL, revision TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(question_id,revision))',
  );
  const tables = await tx.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='visit_question_periods'",
  );
  if (!tables.rows.length) await setupVisitQuestionPeriods(tx);
  await tx.execute(
    'CREATE TRIGGER IF NOT EXISTS visit_period_policy_deleted AFTER DELETE ON visit_questions BEGIN DELETE FROM visit_period_policy WHERE question_id=OLD.id; END',
  );
}

export async function markCurrentVisitPeriod(
  tx: SqlExecutor,
  question: VisitQuestion,
) {
  await setup(tx);
  await tx.execute(
    "INSERT OR IGNORE INTO visit_period_policy VALUES (?,?,'current')",
    [question.id, fingerprint(question)],
  );
}

/** An old missing contributor cannot be reconstructed from an unchanged aggregate.
 * Quarantine only the old artifact; later verified captures do not inherit its lifetime limit. */
export async function legacyVisitPeriodAvailable(
  tx: SqlExecutor,
  question: VisitQuestion,
) {
  await setup(tx);
  for (const source of question.healthContextSources ?? [])
    await appendVisitQuestionPeriod(tx, question.id, source);
  if (
    !(await visitGeneratedSourcesAvailable(
      tx,
      question.generatedArtifactSources,
    ))
  )
    return false;
  const revision = fingerprint(question);
  const policy = await tx.execute(
    'SELECT status FROM visit_period_policy WHERE question_id=? AND revision=?',
    [question.id, revision],
  );
  if (policy.rows.length) return policy.rows[0]?.status === 'current';
  let available = true;
  for (const source of question.healthContextSources ?? []) {
    if (!['measurements', 'activity'].includes(source.scope.topic)) continue;
    const report = await readHealthContextReport(tx, source.scope.window, [
      source.scope.topic,
    ]);
    if (
      report.deletionGeneration !== source.deletionGeneration ||
      healthContextRevision(source.scope, report) !== source.revision
    )
      available = false;
  }
  await tx.execute('INSERT OR IGNORE INTO visit_period_policy VALUES (?,?,?)', [
    question.id,
    revision,
    available ? 'current' : 'quarantined',
  ]);
  return available;
}

/** Only the repository's matching persisted artifact can convey a current-policy decision. */
export async function readVisitPeriodPolicy(
  records: import('@orot/storage').RecordRepository,
  question: VisitQuestion,
) {
  if (!question.healthContextSources?.length) return true;
  if (
    question.healthContextSources.some(
      source =>
        !VisitQuestionHealthContextSourceSchema.safeParse(source).success,
    )
  )
    throw new SavedVisitQuestionsReadError('invalid_question');
  return records.transaction(async (writer, tx) => {
    if (!tx) return false;
    const stored = await writer.get('visit_question', question.id);
    if (!stored || fingerprint(stored) !== fingerprint(question)) return false;
    return legacyVisitPeriodAvailable(tx, stored);
  });
}
