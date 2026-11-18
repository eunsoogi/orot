/** Pre-batching production oracle, preserved for synthetic differential checks. */
import type { HealthContextTopic } from '../../healthEvidence/healthContext/types';
import { periodRemovalQuery } from '../periodRemovalMembership';
import {
  localQueryTimestampKey,
  localQueryTimestampKeyExpression,
  type SqlExecutor,
} from '@orot/storage';
import type { SavedPeriodSummarySource } from '../../diseaseHypotheses/savedSummaries';
import { healthPeriodDeletionGuards } from '../healthPeriodDependencies';
import { RetainedSourceInvalidError } from '../../aiFeatures/integration/retainedSourceError';

// Exhaustive topic mapping mirrors the discriminants in healthPeriodDeletionGuards.
// A new topic must choose its contributor tables instead of silently reusing health rows.
const topicTables: Record<HealthContextTopic, readonly string[]> = {
  measurements: ['health_observations'],
  activity: ['health_observations'],
  sleep: ['health_observations'],
  symptoms: ['symptom_entries'],
  medications: [
    'medication_definitions',
    'medication_assertions',
    'dose_events',
  ],
};

/** Existing markers must also fence a period captured after a logical removal. */
export async function previousPeriodNotRemoved(
  tx: SqlExecutor,
  source: SavedPeriodSummarySource,
) {
  const bindings = [
    source.scope.topic,
    localQueryTimestampKey(source.scope.window.fromInclusive),
    localQueryTimestampKey(source.scope.window.toExclusive),
  ];
  for (const [table, guard] of Object.entries(
    healthPeriodDeletionGuards(source.scope.topic),
  )) {
    // These are the exact topic discriminants in the shared contributor guards,
    // not observed-empty data or cached availability assumptions.
    if (!topicTables[source.scope.topic].includes(table)) continue;
    for (const marker of [
      'source_deletion_tombstones',
      'agent_memory_removed_sources',
    ]) {
      const at = localQueryTimestampKeyExpression('h.effective_at');
      // Candidate ranges are supersets of the contributor predicate. Split points
      // and workout overlaps so generic concepts retain indexed time bounds.
      const candidates =
        table !== 'health_observations'
          ? ['1']
          : source.scope.topic === 'measurements'
            ? [
                `${at} >= p.from_key AND ${at} < p.to_key`,
                `json_extract(h.payload_json, '$.concept') = 'workout_duration' AND ${at} < p.to_key`,
              ]
            : source.scope.topic === 'activity'
              ? [`${at} >= p.from_key AND ${at} < p.to_key`]
              : source.scope.topic === 'sleep'
                ? [
                    `json_extract(h.payload_json, '$.concept') IN ('sleep', 'HKCategoryTypeIdentifierSleepAnalysis') AND ${at} < p.to_key`,
                  ]
                : ['0'];
      for (const candidate of candidates) {
        // Apply the same contributor and time filters to direct, singleton and
        // legacy-shape candidates; indexed lookup never substitutes for validation.
        const result = await tx.execute(
          periodRemovalQuery(table, marker, guard, candidate),
          bindings,
        );
        if (result.rows.length)
          throw new RetainedSourceInvalidError('A period source was removed.');
      }
    }
  }
}
