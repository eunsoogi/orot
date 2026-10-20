import {
  localQueryTimestampKeyExpression,
  type SqlExecutor,
} from '@orot/storage';
import type { VisitQuestionHealthContextSource } from '@orot/domain';
import { readHealthContextReport } from '../healthEvidence/healthContext/reader';
import { healthContextRevision } from '../healthEvidence/healthContext/scope';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';

/** The same contributor rules govern summaries and visit questions, including sleep intervals crossing midnight. */
export function healthPeriodDeletionGuards(): Readonly<Record<string, string>> {
  const time = localQueryTimestampKeyExpression('OLD.effective_at');
  const symptom = localQueryTimestampKeyExpression(
    "coalesce(json_extract(OLD.payload_json, '$.startedAt'), OLD.effective_at)",
  );
  const end = localQueryTimestampKeyExpression(
    "json_extract(OLD.payload_json, '$.endedAt')",
  );
  const point = (at: string) => `${at} >= p.from_key AND ${at} < p.to_key`;
  const concept = "json_extract(OLD.payload_json, '$.concept')";
  return {
    health_observations: `(p.topic = 'measurements' AND ${concept} IN ('blood pressure systolic', 'blood_pressure_systolic', 'blood pressure diastolic', 'blood_pressure_diastolic', 'heart_rate', 'body_mass', 'weight') AND ${point(time)}) OR (p.topic = 'activity' AND ${concept} = 'step_count' AND ${point(time)}) OR (p.topic = 'sleep' AND ${concept} IN ('HKCategoryTypeIdentifierSleepAnalysis', 'sleep') AND ${time} < p.to_key AND ${end} > p.from_key)`,
    medication_definitions: "p.topic = 'medications'",
    medication_assertions: "p.topic = 'medications'",
    dose_events: `p.topic = 'medications' AND ${point(time)}`,
    symptom_entries: `p.topic = 'symptoms' AND ${point(symptom)}`,
  };
}

/** A removed period version gets an opaque fence; later recomputations use a different version. */
export function healthPeriodDependencyId(
  source: VisitQuestionHealthContextSource,
): string {
  return `health-period-version-${fingerprint(source)}`;
}

/** The primary-key prefix lookup avoids loading every historical raw-source tombstone on each memory recall. */
export async function listInvalidatedHealthPeriods(
  tx: SqlExecutor,
): Promise<string[]> {
  const result = await tx.execute(
    "SELECT source_id FROM agent_memory_removed_sources WHERE source_id GLOB 'health-period-version-*'",
  );
  return result.rows.flatMap(row =>
    typeof row.source_id === 'string' ? [row.source_id] : [],
  );
}

/** Re-read inside the caller's write transaction so deletion cannot race a derived insert. */
export async function assertHealthPeriodCurrent(
  tx: SqlExecutor,
  source: VisitQuestionHealthContextSource,
) {
  const report = await readHealthContextReport(tx, source.scope.window, [
    source.scope.topic,
  ]);
  if (
    report.deletionGeneration !== source.deletionGeneration ||
    healthContextRevision(source.scope, report) !== source.revision
  )
    throw new Error('The cited health period changed before saving.');
}
