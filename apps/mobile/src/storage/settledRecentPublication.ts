import type { SqlDatabase } from '@orot/storage';
import {
  BoundReadWitnessUnavailable,
  guardedBoundTransaction,
  type BoundReadResultWitness,
} from './boundReadResultWitness';

export type RecentSettledRole = 'media' | 'material';
export type RecentSettledFrontier = Readonly<{
  head?: Readonly<{ key: string; createdAt: string }>;
  tail?: Readonly<{ key: string; createdAt: string }>;
  more: boolean;
  positions: readonly Readonly<{ key: string; createdAt: string }>[];
}>;

type StampOwner = { database: SqlDatabase; witness: BoundReadResultWitness };
const publishedStamps = new WeakMap<object, StampOwner>();

/** No rows, bodies or locators. A receipt cannot authorize an active read on its own. */
export function settleRecentPublication(
  database: SqlDatabase,
  request: BoundReadResultWitness,
  role: RecentSettledRole,
  rows: readonly Readonly<{ key: string; createdAt: string }>[],
  more: boolean,
  owner: () => boolean,
) {
  if ((!rows.length && more) || !owner()) return;
  const witness = request.forkSettled(owner);
  if (!witness) return;
  const head = rows[0];
  const tail = rows.at(-1);
  const same = (
    left: typeof head | undefined,
    right: typeof head | undefined,
  ) => left?.key === right?.key && left?.createdAt === right?.createdAt;
  const position = (row: typeof head | undefined) =>
    row && Object.freeze({ key: row.key, createdAt: row.createdAt });
  const frontier: RecentSettledFrontier = Object.freeze({
    head: position(head),
    tail: position(tail),
    more,
    positions: Object.freeze(
      rows.map(row =>
        Object.freeze({ key: row.key, createdAt: row.createdAt }),
      ),
    ),
  });
  const receipt = Object.freeze({
    role,
    frontier,
    async readmit(
      expectedRole: RecentSettledRole,
      expected: RecentSettledFrontier,
      active: () => boolean,
    ) {
      const current = () => active() && witness.current();
      if (
        role !== expectedRole ||
        more !== expected.more ||
        !same(frontier.head, expected.head) ||
        !same(frontier.tail, expected.tail) ||
        frontier.positions.length !== expected.positions.length ||
        !frontier.positions.every((value, index) =>
          same(value, expected.positions[index]),
        ) ||
        !current()
      )
        return false;
      try {
        await guardedBoundTransaction(
          database,
          witness,
          async () => {
            if (!current()) throw new BoundReadWitnessUnavailable();
          },
          sql => ({
            execute(statement, parameters) {
              if (!current()) throw new BoundReadWitnessUnavailable();
              return sql.execute(statement, parameters);
            },
          }),
        );
        return current();
      } catch {
        return false;
      }
    },
    current: witness.current,
    beforeRetire: witness.beforeRetire,
    dispose: witness.dispose,
  });
  publishedStamps.set(receipt, { database, witness });
  return receipt;
}

type Receipt = NonNullable<ReturnType<typeof settleRecentPublication>>;
type Lane = Readonly<{ receipt?: Receipt; frontier: RecentSettledFrontier }>;
const samePosition = (
  a: RecentSettledFrontier['head'],
  b: RecentSettledFrontier['head'],
) => a?.key === b?.key && a?.createdAt === b?.createdAt;
function match(expected: RecentSettledFrontier, actual: RecentSettledFrontier) {
  return (
    expected.more === actual.more &&
    samePosition(expected.head, actual.head) &&
    samePosition(expected.tail, actual.tail) &&
    expected.positions.length === actual.positions.length &&
    expected.positions.every((position, index) =>
      samePosition(position, actual.positions[index]),
    )
  );
}

/** First-page, two-certified-stream case only. This produces no data and does not
 * grant later opens, pagination or refresh. Missing streams use the cold path. */
export async function readmitSettledRecentPair(
  input: Readonly<{
    media: Lane;
    material: Lane;
    firstPageOnly: boolean;
    activeOwner: () => boolean;
    protectedReadable: () => Promise<boolean | null>;
  }>,
  admit: () => void,
) {
  const get = (lane: Lane, role: RecentSettledRole) => {
    const receipt = lane.receipt;
    return receipt &&
      receipt.role === role &&
      match(lane.frontier, receipt.frontier)
      ? publishedStamps.get(receipt)
      : undefined;
  };
  const media = get(input.media, 'media');
  const material = get(input.material, 'material');
  if (
    !input.firstPageOnly ||
    !media ||
    !material ||
    media.database !== material.database
  )
    return false;
  const current = () =>
    input.activeOwner() &&
    media.witness.current() &&
    material.witness.current();
  const samplePair = () =>
    guardedBoundTransaction(
      media.database,
      media.witness,
      tx => material.witness.sample(tx),
      tx => ({
        execute(sql, values) {
          if (!current()) throw new BoundReadWitnessUnavailable();
          return tx.execute(sql, values);
        },
      }),
    );
  try {
    if (!current() || (await input.protectedReadable()) !== true || !current())
      return false;
    await samplePair();
    if (!current() || (await input.protectedReadable()) !== true || !current())
      return false;
    // Other connections do not advance this JavaScript owner's epoch. Re-sample
    // both exact stamps after the last native await, with sticky lock/currentness
    // still gating every SQL call and the synchronous handoff.
    await samplePair();
    if (!current()) return false;
    admit();
    return true;
  } catch {
    return false;
  }
}
