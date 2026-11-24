import { localQueryTimestampKey, type SqlDatabase } from '@orot/storage';
import type { CatalogCursor, RecentMaterialRow } from './catalog';
import {
  openAttestedMemoryProbe,
  type AgentProbeCursor,
} from './attestedRecentMemoryProjection';
import { recentMaterialTimestamp } from './recentMaterialTimestamp';

type Position = { readonly key: string; readonly clock: string };
type Row = { readonly key: string; readonly createdAt: string };
type Probe<RowType extends Row> = {
  // Every physical index entry examined is represented, including denied entries.
  readonly entries: readonly {
    readonly position: Position;
    readonly admitted?: RowType;
  }[];
  readonly exhausted: boolean;
};
type State<R extends Row> = {
  readonly resume?: Position;
  readonly held: readonly R[];
};
type Result<R extends Row> =
  | { readonly kind: 'incomplete'; readonly state: State<R> }
  | { readonly kind: 'complete'; readonly rows: readonly R[] };

function compareBinary(left: string, right: string): number {
  if (left === right) return 0;
  const other = right[Symbol.iterator]();
  for (const unit of left) {
    const next = other.next();
    if (next.done) return 1;
    const difference = unit.codePointAt(0)! - next.value.codePointAt(0)!;
    if (difference) return difference;
  }
  return -1;
}

function comparePosition(left: Position, right: Position): number {
  if (left.clock !== right.clock) return left.clock > right.clock ? -1 : 1;
  return compareBinary(right.key, left.key);
}

/**
 * Certify only a full visible material prefix or an actually exhausted merge.
 * A raw, even denied slot proves that every unseen attested row is older.
 * The caller must retain incomplete state privately under the same owning DB
 * revision and reprove that revision when publishing, including staged refresh.
 */
function certifyMaterialProbe<R extends Row>(
  ordinary: readonly R[],
  state: State<R>,
  probe: Probe<R>,
  positionOf: (row: R) => Position,
  pageSize: number,
): Result<R> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1)
    throw new Error('Invalid material page size.');
  if (!probe.exhausted && !probe.entries.length)
    throw new Error('An open metadata probe must advance its cursor.');
  let resume = state.resume;
  const held = [...state.held];
  for (const { position, admitted } of probe.entries) {
    if (resume && comparePosition(resume, position) >= 0)
      throw new Error('The protected metadata cursor did not advance.');
    if (admitted && comparePosition(position, positionOf(admitted)) !== 0)
      throw new Error('The admitted row does not match its index position.');
    resume = position;
    if (admitted && held.length < pageSize) held.push(admitted);
  }
  const rows = [...ordinary, ...held]
    .sort((left, right) => comparePosition(positionOf(left), positionOf(right)))
    .slice(0, pageSize);
  // The ordinary stream already produced its own first page under the same
  // revision: when full, its omitted tail cannot enter the merged first page.
  const tail = rows.at(-1);
  if (
    probe.exhausted ||
    (rows.length === pageSize &&
      resume &&
      tail &&
      comparePosition(positionOf(tail), resume) <= 0)
  )
    return { kind: 'complete', rows };
  return { kind: 'incomplete', state: { resume, held } };
}

/** Offered only by the app's exact guarded owner after legacy readiness. */
export interface RecentMaterialReadyLease {
  readonly database: SqlDatabase;
  readonly isCurrent: () => boolean;
}

export async function readProtectedRecentMaterialPage(
  lease: RecentMaterialReadyLease,
  before: CatalogCursor | undefined,
  options: { readonly signal: AbortSignal; readonly isCurrent: () => boolean },
) {
  const probe = openAttestedMemoryProbe(
    lease.database,
    () => options.isCurrent() && lease.isCurrent(),
    options.signal,
  );
  const witness = { ...probe.witness, dispose: probe.close };
  const width = 20;
  type Step =
    | { kind: 'pending'; witness: typeof witness; advance: () => Promise<Step> }
    | {
        kind: 'complete';
        witness: typeof witness;
        rows: readonly RecentMaterialRow[];
        more: boolean;
      };
  let state: State<RecentMaterialRow> = { held: [] };
  let cursor: AgentProbeCursor | undefined;
  const positionOf = (row: RecentMaterialRow): Position => ({
    clock: localQueryTimestampKey(recentMaterialTimestamp(row.createdAt)),
    key: row.key,
  });
  try {
    const ordinary = await probe.ordinary(before, width + 1);
    const advance = async (): Promise<Step> => {
      const slice = await probe.read(before, cursor);
      const result = certifyMaterialProbe(
        ordinary,
        state,
        slice,
        positionOf,
        width + 1,
      );
      if (result.kind === 'complete')
        return {
          kind: 'complete',
          witness,
          rows: result.rows.slice(0, width),
          more: result.rows.length > width,
        };
      state = result.state;
      cursor = slice.entries.at(-1)?.cursor;
      return { kind: 'pending', witness, advance };
    };
    return await advance();
  } catch (error) {
    witness.dispose();
    throw error;
  }
}
