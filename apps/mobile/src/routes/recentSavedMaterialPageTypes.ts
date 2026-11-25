export type RecentPageRow = {
  readonly key: string;
  readonly createdAt: string;
};

export type RecentPageWitness = {
  // The source's unchanging revision and protected-owner lease, not just the route.
  readonly isCurrent: () => boolean;
  readonly requireCurrent?: () => void;
  readonly verify: (rethrowRevision?: true) => Promise<boolean>;
  readonly dispose?: () => void;
};

type WitnessedRecentPage<Row> =
  | {
      readonly kind: 'pending';
      readonly witness: RecentPageWitness;
      readonly advance: () => Promise<WitnessedRecentPage<Row>>;
    }
  | {
      readonly kind: 'complete';
      readonly witness: RecentPageWitness;
      readonly rows: readonly Row[];
      readonly more: boolean;
    };

export type RecentPage<Row> = readonly Row[] | WitnessedRecentPage<Row>;

export function isWitnessedPage<Row>(
  page: RecentPage<Row>,
): page is WitnessedRecentPage<Row> {
  return 'witness' in page;
}

export type Ref<T> = { current: T };
type RecentPageError = 'failed' | 'refused';
export type RecentPageState = 'idle' | 'loading' | 'ready' | RecentPageError;
export type LoadRecentPage<Row> = ((
  before?: RecentPageRow,
  options?: {
    signal: AbortSignal;
    canRetry: () => Promise<boolean>;
    isCurrent: () => boolean;
  },
) => Promise<RecentPage<Row>>) & { readonly sourceIsCurrent?: () => boolean };
