import type { HealthContextTopic } from '../healthEvidence/healthContext/types';
import { localQueryTimestampKeyExpression } from '@orot/storage';
/** Build shared contributor predicates. Trigger callers omit topic and retain the
 * exact full expression; queries specialize without weakening the bound topic check.
 * No source verdict or database generation is cached by this pure SQL builder. */
export function healthPeriodDeletionGuards(
  topic?: HealthContextTopic,
): Readonly<Record<string, string>> {
  const time = localQueryTimestampKeyExpression('OLD.effective_at');
  const symptom = localQueryTimestampKeyExpression(
    "coalesce(json_extract(OLD.payload_json, '$.startedAt'), OLD.effective_at)",
  );
  const end = localQueryTimestampKeyExpression(
    "json_extract(OLD.payload_json, '$.endedAt')",
  );
  const point = (at: string) => `${at} >= p.from_key AND ${at} < p.to_key`;
  const rawConcept = "json_extract(OLD.payload_json, '$.concept')";
  const concept = `lower(${rawConcept})`;
  const clinical =
    "json_extract(OLD.payload_json, '$.observationKind') NOT IN ('diagnosis', 'allergy', 'procedure')";
  const numeric =
    "json_extract(OLD.payload_json, '$.value.kind') = 'quantity' AND json_type(OLD.payload_json, '$.value.amount') IN ('integer', 'real') AND json_type(OLD.payload_json, '$.value.unit') = 'text'";
  const measurement =
    "json_extract(OLD.payload_json, '$.observationKind') = 'measurement'";
  const activity = `${concept} IN ('step_count', 'workout_duration')`;
  // Workout intervals also contribute to heart-rate context in measurement reports,
  // including intervals starting before the saved window. Do not reduce these to point membership.
  // A stored period descriptor does not attest absence of heart-rate series, so
  // workout overlap conservatively fences measurement scopes even without one.
  const workoutOverlap = `${rawConcept} = 'workout_duration' AND ${time} < p.to_key AND ${end} > p.from_key AND ${end} > ${time}`;
  const topics: Record<string, string> = {
    measurements: `p.topic = 'measurements' AND (((${measurement}) AND (${numeric}) AND NOT (${activity}) AND ${point(time)}) OR (${workoutOverlap}))`,
    activity: `p.topic = 'activity' AND (${measurement} OR ${concept} = 'workout_duration') AND (${numeric}) AND (${activity}) AND ${point(time)}`,
    sleep: `p.topic = 'sleep' AND ${rawConcept} IN ('HKCategoryTypeIdentifierSleepAnalysis', 'sleep') AND ${time} < p.to_key AND ${end} > p.from_key`,
  };
  const full = `${clinical} AND ((${topics.measurements}) OR (${topics.activity}) OR (${topics.sleep}))`;
  if (
    topic !== undefined &&
    !['measurements', 'activity', 'sleep', 'symptoms', 'medications'].includes(
      topic,
    )
  )
    throw new Error('Unknown topic');
  return {
    health_observations:
      topic !== undefined
        ? topics[topic]
          ? `${clinical} AND (${topics[topic]})`
          : '0'
        : full,
    medication_definitions: "p.topic = 'medications'",
    medication_assertions: "p.topic = 'medications'",
    dose_events: `p.topic = 'medications' AND ${point(time)}`,
    symptom_entries: `p.topic = 'symptoms' AND ${point(symptom)}`,
  };
}
