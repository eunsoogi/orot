import { visitGeneratedSourcesAvailable } from './visitGeneratedSourcePolicy';
import { VisitQuestionSchema, type VisitQuestionRecord } from '@orot/domain';
import { readVisitQuestionRevision, type SqlExecutor } from '@orot/storage';
import {
  fingerprint,
  stableJson,
} from '../aiFeatures/integration/evidenceUtils';
import { readHealthContextReport } from '../healthEvidence/healthContext/reader';
import { healthContextRevision } from '../healthEvidence/healthContext/scope';

/** Official-record snapshots have their own policy identity; an unrelated parent or
 * an opaque source object cannot promote a legacy official record into trusted evidence. */
export async function officialVisitPeriodAvailable(
  tx: SqlExecutor,
  record: VisitQuestionRecord,
) {
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS official_visit_period_policy (record_id TEXT NOT NULL, revision TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(record_id,revision))',
  );
  await tx.execute(
    'CREATE TRIGGER IF NOT EXISTS official_visit_period_policy_deleted AFTER DELETE ON visit_question_records BEGIN DELETE FROM official_visit_period_policy WHERE record_id=OLD.id; END',
  );
  for (const snapshot of record.questionSources ?? [])
    if (
      !(await visitGeneratedSourcesAvailable(
        tx,
        snapshot.generatedArtifactSources,
      ))
    )
      return false;
  const revision = fingerprint(record);
  const old = await tx.execute(
    'SELECT status FROM official_visit_period_policy WHERE record_id=? AND revision=?',
    [record.id, revision],
  );
  if (old.rows.length) return old.rows[0]?.status === 'current';
  const periods = (record.questionSources ?? [])
    .flatMap(snapshot => snapshot.healthContextSources ?? [])
    .filter(source =>
      ['measurements', 'activity'].includes(source.scope.topic),
    );
  let available = true;
  if (periods.length && !(await hasVerifiedParent(tx, record))) {
    for (const source of periods) {
      const report = await readHealthContextReport(tx, source.scope.window, [
        source.scope.topic,
      ]);
      if (
        report.deletionGeneration !== source.deletionGeneration ||
        healthContextRevision(source.scope, report) !== source.revision
      )
        available = false;
    }
  }
  await tx.execute(
    'INSERT OR IGNORE INTO official_visit_period_policy VALUES (?,?,?)',
    [record.id, revision, available ? 'current' : 'quarantined'],
  );
  return available;
}

async function hasVerifiedParent(tx: SqlExecutor, record: VisitQuestionRecord) {
  const exists = await tx.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='visit_period_policy'",
  );
  if (!exists.rows.length) return false;
  const raw = await tx.execute(
    'SELECT payload_json FROM visit_questions WHERE id=?',
    [record.questionId],
  );
  if (typeof raw.rows[0]?.payload_json !== 'string') return false;
  const parsed = VisitQuestionSchema.safeParse(
    JSON.parse(raw.rows[0].payload_json),
  );
  if (
    !parsed.success ||
    (await readVisitQuestionRevision(tx, record.questionId)) !==
      record.questionRevision
  )
    return false;
  const parent = parsed.data;
  const policy = await tx.execute(
    'SELECT status FROM visit_period_policy WHERE question_id=? AND revision=?',
    [parent.id, fingerprint(parent)],
  );
  if (policy.rows[0]?.status !== 'current') return false;
  const expected = stableJson({
    ...(parent.healthContextSources
      ? { healthContextSources: parent.healthContextSources }
      : {}),
    ...(parent.generatedArtifactSources
      ? { generatedArtifactSources: parent.generatedArtifactSources }
      : {}),
  });
  return (record.questionSources ?? []).every(
    snapshot => stableJson(snapshot) === expected,
  );
}
