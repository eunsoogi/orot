import {
  localQueryTimestampKeyExpression,
  type SqlExecutor,
} from '@orot/storage';

const concept = "json_extract(payload_json, '$.concept')";
const time = localQueryTimestampKeyExpression('effective_at');
const ingestion = localQueryTimestampKeyExpression('ingested_at');
const kind = "json_extract(payload_json, '$.observationKind')";
const unit = "json_extract(payload_json, '$.value.unit')";
const amount = "json_extract(payload_json, '$.value.amount')";
const sensor =
  "COALESCE(json_extract(payload_json, '$.provenance.source.sourceIdentifier'), json_extract(payload_json, '$.provenance.origin')) || ':' || COALESCE(json_extract(payload_json, '$.provenance.source.productType'), json_extract(payload_json, '$.provenance.source.device.model'), '')";
const valueChecks = [
  "json_extract(payload_json, '$.value.kind')",
  "json_type(payload_json, '$.value.amount')",
  "json_type(payload_json, '$.value.unit')",
];

/** First uncached reports otherwise fetch and parse every admitted payload even
 * after the timestamp seek. These scalar-only covering indexes let SQLite read
 * the same query inputs from its own index pages, not a retained report cache.
 * INSERT/UPDATE/DELETE maintain them transactionally in the same protected DB.
 * Queries, stale-source guards, cutoffs, sorting and all samples stay unchanged.
 * Separate time/concept prefixes serve generic quantities and heart intervals;
 * existing narrow indexes remain available to other readers. Creation is a
 * one-time derived-index cost, distinct from later cold restoration timing.
 */
export async function ensureHealthContextCoveringIndexes(
  executor: SqlExecutor,
): Promise<void> {
  const quantities = [
    time,
    ingestion,
    kind,
    `lower(${concept})`,
    ...valueChecks,
    unit,
    amount,
    sensor,
    'id',
    'effective_at',
  ];
  const heart = [
    concept,
    time,
    localQueryTimestampKeyExpression("json_extract(payload_json, '$.endedAt')"),
    ingestion,
    kind,
    unit,
    amount,
    sensor,
    ...valueChecks,
    'id',
  ];
  await executor.execute(
    `CREATE INDEX IF NOT EXISTS health_context_observation_covering ON health_observations (${quantities.join(', ')})`,
  );
  await executor.execute(
    `CREATE INDEX IF NOT EXISTS health_context_heart_covering ON health_observations (${heart.join(', ')})`,
  );
}
