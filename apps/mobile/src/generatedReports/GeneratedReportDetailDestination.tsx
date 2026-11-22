import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { useNavigationRouteScrollPosition } from '../navigation/NavigationRouteScrollView';
import {
  GeneratedReportDetailPresentation,
  type GeneratedReportDetailPresentationState,
} from './GeneratedReportDetailPresentation';
import { openGeneratedReportReader } from './readers';
import type {
  GeneratedReportCitationSelection,
  GeneratedReportRow,
} from './types';
import { useGeneratedReportAccess } from './useGeneratedReportAccess';

type SourceTrip = {
  phase: 'leaving' | 'covered' | 'returning' | 'restore';
  readonly target: GeneratedReportCitationSelection['target'];
};

/** Reopen one selected metadata identity locally, never passing report prose through navigation. */
export function GeneratedReportDetailDestination({
  row,
  active,
  ownership,
  openReportSource,
}: {
  readonly row: GeneratedReportRow;
  readonly active: boolean;
  readonly ownership?: NavigationRouteOwnership;
  readonly openReportSource?: (
    selection: GeneratedReportCitationSelection,
  ) => boolean;
}) {
  const request = useRef<AbortController | null>(null);
  const started = useRef(false);
  const renewable = useRef(false);
  const resumeRow = useRef<GeneratedReportRow | null>(null);
  const generation = useRef(0);
  const sourceTrip = useRef<SourceTrip | undefined>(undefined);
  const scroll = useNavigationRouteScrollPosition();
  const [state, setState] = useState<GeneratedReportDetailPresentationState>({
    status: 'loading',
  });
  const abort = useCallback(() => {
    request.current?.abort();
    request.current = null;
  }, []);
  const invalidate = useCallback(() => {
    renewable.current = false;
    if (resumeRow.current) {
      resumeRow.current = null;
      started.current = true;
    }
    abort();
    setState({ status: 'unavailable' });
  }, [abort]);
  const suspend = useCallback(() => {
    if (!renewable.current) {
      invalidate();
      return;
    }
    // Clear the protected snapshot immediately; only this row may be renewed.
    resumeRow.current = row;
    started.current = false;
    abort();
    setState({ status: 'loading' });
  }, [abort, invalidate, row]);
  const { accessVersion, canAccess } = useGeneratedReportAccess(
    active,
    ownership,
    invalidate,
    abort,
    false,
    suspend,
  );
  useLayoutEffect(() => {
    const trip = sourceTrip.current;
    if (!active && trip?.phase === 'leaving') trip.phase = 'covered';
    if (active && trip?.phase === 'covered') {
      // Only this report's explicit source child may start another local read.
      // Never republish the previously open result without a new proof.
      trip.phase = 'returning';
      started.current = false;
    }
  }, [active]);
  useLayoutEffect(() => {
    if (
      state.status === 'ready' &&
      sourceTrip.current?.phase === 'restore' &&
      canAccess()
    ) {
      sourceTrip.current = undefined;
      scroll?.restore();
    }
  }, [canAccess, scroll, state]);
  const read = useCallback(async () => {
    if (!canAccess()) return;
    abort();
    resumeRow.current = null;
    renewable.current = true;
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
      const trip = sourceTrip.current;
      if (trip?.phase === 'returning') {
        const renewed = detail?.conversationSources?.target;
        if (
          renewed?.sessionId !== trip.target.sessionId ||
          renewed.sessionVersion !== trip.target.sessionVersion
        ) {
          sourceTrip.current = undefined;
          renewable.current = false;
          setState({ status: 'unavailable' });
          return;
        }
        trip.phase = 'restore';
      }
      renewable.current = Boolean(detail);
      setState(
        detail
          ? { status: 'ready', detail, generation: ++generation.current }
          : { status: 'unavailable' },
      );
    } catch {
      if (current()) {
        renewable.current = false;
        setState({ status: 'failed' });
      }
    }
  }, [abort, canAccess, row]);
  useEffect(() => {
    if (started.current || !canAccess()) return;
    if (resumeRow.current && resumeRow.current !== row) {
      invalidate();
      return;
    }
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
  }, [accessVersion, active, canAccess, invalidate, read, row]);
  if (!active || (ownership && !ownership.isCurrent())) return null;
  const owner = request.current;
  return (
    <GeneratedReportDetailPresentation
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
      onOpenCitation={
        openReportSource &&
        (selection => {
          if (
            request.current !== owner ||
            !owner ||
            owner.signal.aborted ||
            !canAccess() ||
            selection.target.turnId !== row.id ||
            selection.target.createdAt !== row.createdAt
          )
            return;
          sourceTrip.current = { phase: 'leaving', target: selection.target };
          scroll?.preserve();
          if (!openReportSource(selection)) sourceTrip.current = undefined;
        })
      }
    />
  );
}
