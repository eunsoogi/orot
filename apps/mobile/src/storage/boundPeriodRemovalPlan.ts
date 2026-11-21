import { localQueryTimestampKey, type SqlExecutor } from '@orot/storage';
import type { SavedPeriodSummarySource } from '../diseaseHypotheses/savedSummaries';
import {
  BoundReadWitnessUnavailable,
  type BoundReadResultWitness,
} from './boundReadResultWitness';
import { assertPeriodNotRemoved } from './conversationPeriodRemoval';

type PeriodRemovalPlan = {
  readonly witness: BoundReadResultWitness;
  readonly accepted: Set<string>;
};

const plans = new WeakMap<SqlExecutor, PeriodRemovalPlan>();
const maximumTasks = 512;

/** Called only inside the witness's authorized provisional SQL work. The
 * hosting operation must sample before and after and replay stock on refusal. */
export async function withBoundPeriodRemovalPlan<T>(
  tx: SqlExecutor,
  witness: BoundReadResultWitness,
  work: () => Promise<T>,
): Promise<T> {
  if (!witness.current() || plans.has(tx))
    throw new BoundReadWitnessUnavailable();
  const plan: PeriodRemovalPlan = { witness, accepted: new Set() };
  plans.set(tx, plan);
  try {
    return await work();
  } finally {
    plans.delete(tx);
  }
}

export function assertPlannedPeriodNotRemoved(
  tx: SqlExecutor,
  source: SavedPeriodSummarySource,
) {
  const plan = plans.get(tx);
  return plan
    ? assertInPlan(tx, source, plan)
    : assertPeriodNotRemoved(tx, source);
}

async function assertInPlan(
  tx: SqlExecutor,
  source: SavedPeriodSummarySource,
  plan: PeriodRemovalPlan,
) {
  if (!plan.witness.current()) throw new BoundReadWitnessUnavailable();

  // These are precisely the original query bindings and shape discriminant.
  // Cutoff, revision, and deletion generation belong to separate report fences.
  const { topic, window } = source.scope;
  const key = JSON.stringify([
    topic,
    localQueryTimestampKey(window.fromInclusive),
    localQueryTimestampKey(window.toExclusive),
  ]);
  if (plan.accepted.has(key)) return;
  await assertPeriodNotRemoved(tx, source);
  if (!plan.witness.current()) throw new BoundReadWitnessUnavailable();
  if (plan.accepted.size < maximumTasks) plan.accepted.add(key);
}
