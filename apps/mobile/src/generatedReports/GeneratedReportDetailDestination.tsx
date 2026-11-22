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
import { useSavedReportPublicCitation } from './useSavedReportPublicCitation';
import {
  savedReportBrowserDepartureDeadline,
  useSavedReportBrowserReturn,
  type SavedReportSourceTrip,
} from './useSavedReportBrowserReturn';
import { watchSavedReportNativeProtection } from './savedReportNativeProtection';

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
  const generation = useRef(0);
  const sourceTrip = useRef<SavedReportSourceTrip | undefined>(undefined);
  const scroll = useNavigationRouteScrollPosition();
  const externalCitation = useSavedReportPublicCitation();
  const browserReturn = useSavedReportBrowserReturn(sourceTrip, started);
  const [state, setState] = useState<GeneratedReportDetailPresentationState>({
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
  useLayoutEffect(() => {
    const trip = sourceTrip.current;
    if (trip?.surface !== 'stack') return;
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
    const controller = new AbortController();
    request.current = controller;
    const current = () =>
      request.current === controller &&
      !controller.signal.aborted &&
      canAccess();
    setState({ status: 'loading' });
    const trip = sourceTrip.current;
    const protectedReturn =
      trip?.surface === 'browser' && trip.phase === 'returning';
    const revoked = () => {
      if (!current()) return;
      sourceTrip.current = undefined;
      invalidate();
    };
    const protection = protectedReturn
      ? watchSavedReportNativeProtection(controller.signal, revoked)
      : undefined;
    const confirm = () => protection?.confirm();
    let retainProtection = false;
    try {
      if (protectedReturn && (!(await confirm()) || !current())) return;
      const reader = await openGeneratedReportReader();
      if (!current() || (protectedReturn && (!(await confirm()) || !current())))
        return;
      const detail = await reader.read(row, controller.signal);
      if (!current() || (protectedReturn && (!(await confirm()) || !current())))
        return;
      if (trip?.phase === 'returning') {
        const renewed = detail?.conversationSources?.target;
        if (
          renewed?.sessionId !== trip.target.sessionId ||
          renewed.sessionVersion !== trip.target.sessionVersion
        ) {
          sourceTrip.current = undefined;
          setState({ status: 'unavailable' });
          return;
        }
        trip.phase = 'restore';
      }
      // Keep the same published browser-return owner subscribed until close;
      // a lock can arrive before React has committed the newly verified body.
      retainProtection = protectedReturn && detail !== null;
      setState(
        detail
          ? { status: 'ready', detail, generation: ++generation.current }
          : { status: 'unavailable' },
      );
    } catch {
      if (current()) setState({ status: 'failed' });
    } finally {
      if (!retainProtection) protection?.dispose();
    }
  }, [abort, canAccess, invalidate, row]);
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
  }, [accessVersion, active, browserReturn, canAccess, read]);
  if (!active || (ownership && !ownership.isCurrent())) return null;
  const owner = request.current;
  const isCurrent = () =>
    Boolean(
      owner &&
      request.current === owner &&
      !owner.signal.aborted &&
      canAccess(),
    );
  return (
    <GeneratedReportDetailPresentation
      row={row}
      state={state}
      onRetry={() => {
        if (state.status === 'failed' && request.current === owner) read();
      }}
      isCurrent={isCurrent}
      sourceOpenFailed={Boolean(
        owner && externalCitation.failedOwner === owner.signal,
      )}
      onOpenCitation={
        openReportSource &&
        ((selection, citation) => {
          if (
            !isCurrent() ||
            !owner ||
            state.status !== 'ready' ||
            !state.detail.conversationSources?.citations.includes(citation) ||
            state.detail.conversationSources.target !== selection.target ||
            selection.target.turnId !== row.id ||
            selection.target.createdAt !== row.createdAt
          )
            return;
          if (
            citation.kind === 'public_web' ||
            citation.kind === 'external_medical'
          ) {
            externalCitation.open(
              selection,
              citation,
              owner.signal,
              isCurrent,
              invalidate,
              () => {
                const trip: SavedReportSourceTrip = {
                  phase: 'leaving',
                  surface: 'browser',
                  target: selection.target,
                  departBy: savedReportBrowserDepartureDeadline(),
                };
                sourceTrip.current = trip;
                scroll?.preserve();
                return () => {
                  if (sourceTrip.current === trip && trip.phase === 'leaving')
                    sourceTrip.current = undefined;
                };
              },
            );
            return;
          }
          if (citation.kind !== 'personal_record') return;
          sourceTrip.current = {
            phase: 'leaving',
            surface: 'stack',
            target: selection.target,
          };
          scroll?.preserve();
          if (!openReportSource(selection)) sourceTrip.current = undefined;
        })
      }
    />
  );
}
