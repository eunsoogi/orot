import { useEffect, useState } from 'react';
import type { RecentPageState } from './requestRecentSavedMaterialPage';

interface PageDemandStream {
  readonly pageEpoch: number;
  readonly state: RecentPageState;
  readonly more: boolean;
  readonly rows: readonly unknown[];
  readonly loadMore: () => Promise<boolean>;
}

/** Each tap grants one page per stream. An invalidation retires the old demand as well as its cursor. */
export function useRecentPageDemand(
  stream: PageDemandStream,
  pageSize: number,
  resumeDepth = 0,
) {
  const [demand, setDemand] = useState<{ epoch: number; depth: number }>();
  const { loadMore, more, pageEpoch, rows, state } = stream;
  const depth = Math.max(
    resumeDepth,
    demand?.epoch === pageEpoch ? demand.depth : pageSize,
  );
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
