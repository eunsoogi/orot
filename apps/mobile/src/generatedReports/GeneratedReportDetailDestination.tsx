import { useCallback, useEffect, useRef, useState } from 'react';
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

import {
  isSameRefreshedReport,
  useGeneratedReportPull,
  type RefreshSelection,
} from './refreshOwnedGeneratedReport';

import {
  hasCurrentSavedReportSourceTrip,
  prepareSavedReportReturnRead,
  useSavedReportTrips,
  type SavedReportSourceTrip,
} from './useSavedReportBrowserReturn';
import {
  openSavedReportCitation,
  useSavedReportPublicCitation,
} from './useSavedReportPublicCitation';

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
  const sourceTrip = useRef<SavedReportSourceTrip | undefined>(undefined);
  const scroll = useNavigationRouteScrollPosition();
  const externalCitation = useSavedReportPublicCitation();
  const [state, setState] = useState<GeneratedReportDetailPresentationState>({
    status: 'loading',
  });
  const abort = useCallback(() => {
    request.current?.abort();
    request.current = null;
  }, []);
  const invalidate = useCallback(() => {
    renewable.current = false;
    const browser = sourceTrip.current?.surface === 'browser';
    if (browser) sourceTrip.current = undefined;
    if (resumeRow.current || browser) {
      resumeRow.current = null;
      started.current = true;
    }
    abort();
    setState({ status: 'unavailable' });
  }, [abort]);
  const suspend = useCallback(() => {
    const trip = sourceTrip.current;
    if (trip?.surface === 'browser') {
      if (trip.phase !== 'leaving' && trip.phase !== 'covered') {
        invalidate();
        return;
      }
      trip.suspended = true;
      abort();
      setState({ status: 'loading' });
      return;
    }
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
  const browserReturn = useSavedReportTrips(
    sourceTrip,
    started,
    active,
    state,
    canAccess,
    scroll,
    invalidate,
  );
  const read = useCallback(
    async (refresh?: RefreshSelection) => {
      if (!canAccess()) return;
      const controller = new AbortController();
      refresh?.claim(controller);
      abort();
      resumeRow.current = null;
      renewable.current = true;
      request.current = controller;
      const current = () =>
        request.current === controller &&
        !controller.signal.aborted &&
        canAccess();
      if (!refresh?.keepVisible) setState({ status: 'loading' });
      const trip = sourceTrip.current;
      const browser = prepareSavedReportReturnRead(
        trip,
        controller.signal,
        current,
        invalidate,
      );
      const verify = browser?.confirm ?? refresh?.verify;
      let ready = false;
      try {
        if (browser && (refresh || !(await browser.confirm()) || !current()))
          return;
        const reader = await openGeneratedReportReader();
        if (!current() || (verify && (!(await verify()) || !current()))) return;
        const detail = await reader.read(row, controller.signal);
        if (!current() || (verify && (!(await verify()) || !current()))) return;
        const prior = refresh?.prior;
        const refreshedTarget = detail?.conversationSources?.target;
        if (prior && !isSameRefreshedReport(prior, refreshedTarget)) {
          invalidate();
          return;
        }
        if (trip?.phase === 'returning') {
          if (
            sourceTrip.current !== trip ||
            !isSameRefreshedReport(trip.target, refreshedTarget)
          ) {
            sourceTrip.current = undefined;
            renewable.current = false;
            setState({ status: 'unavailable' });
            return;
          }
          trip.phase = 'restore';
        }
        ready = Boolean(detail);
        renewable.current = ready;
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
      } finally {
        if (!ready) browser?.dispose();
      }
    },
    [abort, canAccess, invalidate, row],
  );
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
  }, [accessVersion, active, browserReturn, canAccess, invalidate, read, row]);
  const refreshing = useGeneratedReportPull({
    active,
    state,
    request,
    canAccess,
    invalidate,
    read,
    hasSourceTrip: () => hasCurrentSavedReportSourceTrip(sourceTrip),
  });
  if (!active || (ownership && !ownership.isCurrent())) return null;
  const owner = request.current;
  const isCurrent = () =>
    Boolean(
      owner &&
      !refreshing.current &&
      request.current === owner &&
      !owner.signal.aborted &&
      canAccess(),
    );
  return (
    <GeneratedReportDetailPresentation
      row={row}
      state={state}
      onRetry={() => {
        if (
          state.status === 'failed' &&
          request.current === owner &&
          !refreshing.current
        )
          read();
      }}
      isCurrent={isCurrent}
      sourceOpenFailed={Boolean(
        owner && externalCitation.failedOwner === owner.signal,
      )}
      onOpenCitation={
        openReportSource &&
        ((selection, citation) => {
          if (!owner || state.status !== 'ready') return;
          openSavedReportCitation({
            row,
            detail: state.detail,
            selection,
            citation,
            owner,
            isCurrent,
            invalidate,
            sourceTrip,
            scroll,
            openReportSource,
            externalCitation,
          });
        })
      }
    />
  );
}
