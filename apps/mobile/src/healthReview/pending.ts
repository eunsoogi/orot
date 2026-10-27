import { SafetyPolicyDecisionSchema } from '@orot/domain';
import { encounterCanonical } from '@orot/agent-runtime';
import type {
  HealthReviewPending,
  SqliteCheckpointSaver,
} from '@orot/agent-runtime';

type Tuple = Awaited<ReturnType<SqliteCheckpointSaver['getTuple']>>;
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** Accept only the graph's private pending snapshot, never a guessed top-level saver state. */
export function readHealthReviewPending(
  tuple: Tuple,
  sourceId: string,
): HealthReviewPending | null {
  const values = tuple?.checkpoint.channel_values;
  if (!values || values.sourceId !== sourceId || !object(values.pending))
    return null;
  const pending = values.pending;
  const safety = SafetyPolicyDecisionSchema.safeParse(pending.safety);
  // Both graph interrupt paths use insufficient information and exactly these five fields.
  // Reject unknown content instead of stripping it: continuation must submit the unchanged snapshot.
  const pendingKeys = [
    'threadId',
    'sourceId',
    'safety',
    'references',
    'reason',
  ];
  if (
    Object.keys(pending).length !== pendingKeys.length ||
    Object.keys(pending).some(key => !pendingKeys.includes(key)) ||
    pending.threadId !== sourceId ||
    pending.sourceId !== sourceId ||
    !['safety_context', 'evidence'].includes(String(pending.reason)) ||
    !safety.success ||
    safety.data.category !== 'insufficient_information' ||
    !Array.isArray(pending.references) ||
    !Array.isArray(values.references) ||
    encounterCanonical(pending.safety) !== encounterCanonical(values.safety) ||
    encounterCanonical(pending.references) !==
      encounterCanonical(values.references)
  )
    return null;
  for (const reference of pending.references) {
    if (
      !object(reference) ||
      !['personal_record', 'reviewed_memory', 'external_medical'].includes(
        String(reference.sourceKind),
      ) ||
      !['sourceId', 'sourceRevision', 'evidenceId', 'evidenceRevision'].every(
        key => typeof reference[key] === 'string' && reference[key],
      ) ||
      !('locator' in reference) ||
      !(
        reference.effectiveTime === null ||
        typeof reference.effectiveTime === 'string'
      ) ||
      !['reviewed', 'unreviewed', 'unknown'].includes(
        String(reference.reviewState),
      ) ||
      !(reference.unit === undefined || typeof reference.unit === 'string')
    )
      return null;
  }
  return JSON.parse(JSON.stringify(pending)) as HealthReviewPending;
}
