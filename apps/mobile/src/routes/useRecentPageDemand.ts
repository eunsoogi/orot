import { useEffect, useState } from 'react';

interface PageDemandStream {
  readonly pageEpoch: number;
  readonly state: 'idle' | 'loading' | 'ready' | 'failed';
  readonly more: boolean;
  readonly rows: readonly unknown[];
  readonly loadMore: () => Promise<boolean>;
}

/** Each tap grants one page per stream. An invalidation retires the old demand as well as its cursor. */
export function useRecentPageDemand(
  stream: PageDemandStream,
  pageSize: number,
) {
  const [demand, setDemand] = useState<{ epoch: number; depth: number }>();
  const { loadMore, more, pageEpoch, rows, state } = stream;
  const depth = demand?.epoch === pageEpoch ? demand.depth : pageSize;
  useEffect(() => {
    if (state === 'ready' && more && rows.length < depth) {
      // Only the stream's pending guard and exact tail may issue this next page.
      loadMore();
    }
  }, [depth, loadMore, more, rows.length, state]);

  return {
    canAdvance: state === 'ready' && more && rows.length >= depth,
    requestMore: () => {
      if (!more) return;
      setDemand(previous => ({
        epoch: pageEpoch,
        depth:
          (previous?.epoch === pageEpoch ? previous.depth : pageSize) +
          pageSize,
      }));
    },
  };
}
