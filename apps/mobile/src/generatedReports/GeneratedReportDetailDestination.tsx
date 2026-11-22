import { useCallback, useEffect, useRef, useState } from 'react';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import {
  GeneratedReportDetailFallback,
  type GeneratedReportDetailFallbackState,
} from './GeneratedReportDetailFallback';
import { openGeneratedReportReader } from './readers';
import type { GeneratedReportRow } from './types';
import { useGeneratedReportAccess } from './useGeneratedReportAccess';

/** Reopen one selected metadata identity locally, never passing report prose through navigation. */
export function GeneratedReportDetailDestination({
  row,
  active,
  ownership,
}: {
  readonly row: GeneratedReportRow;
  readonly active: boolean;
  readonly ownership?: NavigationRouteOwnership;
}) {
  const request = useRef<AbortController | null>(null);
  const started = useRef(false);
  const generation = useRef(0);
  const [state, setState] = useState<GeneratedReportDetailFallbackState>({
    status: 'loading',
  });
  const abort = useCallback(() => {
    request.current?.abort();
    request.current = null;
  }, []);
  const invalidate = useCallback(() => {
    abort();
    setState({ status: 'unavailable' });
  }, [abort]);
  const { accessVersion, canAccess } = useGeneratedReportAccess(
    active,
    ownership,
    invalidate,
    abort,
  );
  const read = useCallback(async () => {
    if (!canAccess()) return;
    abort();
    const controller = new AbortController();
    request.current = controller;
    const current = () =>
      request.current === controller &&
      !controller.signal.aborted &&
      canAccess();
    setState({ status: 'loading' });
    try {
      const reader = await openGeneratedReportReader();
      if (!current()) return;
      const detail = await reader.read(row, controller.signal);
      if (!current()) return;
      setState(
        detail
          ? { status: 'ready', detail, generation: ++generation.current }
          : { status: 'unavailable' },
      );
    } catch {
      if (current()) setState({ status: 'failed' });
    }
  }, [abort, canAccess, row]);
  useEffect(() => {
    if (started.current || !canAccess()) return;
    let live = true;
    // Strict replay and a synchronous Back must invalidate before any reader starts.
    Promise.resolve().then(() => {
      if (!live || started.current || !canAccess()) return;
      started.current = true;
      read();
    });
    return () => {
      live = false;
    };
  }, [accessVersion, active, canAccess, read]);
  if (!active || (ownership && !ownership.isCurrent())) return null;
  const owner = request.current;
  return (
    <GeneratedReportDetailFallback
      row={row}
      state={state}
      onRetry={() => {
        if (state.status === 'failed' && request.current === owner) read();
      }}
      isCurrent={() =>
        Boolean(
          owner &&
          request.current === owner &&
          !owner.signal.aborted &&
          canAccess(),
        )
      }
    />
  );
}
