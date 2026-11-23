import { GeneratedReportBookmarkAction } from './GeneratedReportBookmarkAction';
import { GeneratedReportContent } from './GeneratedReportContent';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGeneratedReportAccess } from './useGeneratedReportAccess';
import { AppText } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { openGeneratedReportReader } from './readers';
import { generatedReportCopy as copy } from './text';
import {
  GeneratedReportFrame,
  GeneratedReportDescription,
  GeneratedReportRows,
  type GeneratedReportPagination,
} from './GeneratedReportRows';
import type {
  GeneratedReportRow,
  GeneratedReportReader,
  GeneratedReportDetail,
} from './types';
/** A metadata-first local browser. Selection, navigation and invalidation own each
 * async result; late reads never republish text after the user leaves or deletes. */
export function GeneratedReportBrowser({
  active = true,
  open = openGeneratedReportReader,
  destination = false,
  ownership,
  onOpenDestination,
}: {
  readonly active?: boolean;
  readonly open?: () => Promise<GeneratedReportReader>;
  readonly destination?: boolean;
  readonly ownership?: NavigationRouteOwnership;
  readonly onOpenDestination?: (row: GeneratedReportRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<readonly GeneratedReportRow[]>([]);
  const [selected, setSelected] = useState<GeneratedReportRow | null>(null);
  const [detail, setDetail] = useState<{
    readonly value: GeneratedReportDetail;
    readonly owner: AbortController;
    readonly generation: number;
  } | null>(null);
  const generation = useRef(0);
  const [state, setState] = useState<
    'idle' | 'loading' | 'ready' | 'failed' | 'unavailable'
  >('idle');
  const [pagination, setPagination] =
    useState<GeneratedReportPagination>('idle');
  const request = useRef<AbortController | null>(null);
  const inactiveOwner = useRef({});
  const abort = useCallback(() => {
    request.current?.abort();
    request.current = null;
    inactiveOwner.current = {};
  }, []);
  const invalidate = useCallback(() => {
    abort();
    setDetail(null);
    setSelected(null);
    setRows([]);
    setPagination('idle');
    setState('idle');
    setExpanded(false);
  }, [abort]);
  const retainedList = Boolean(onOpenDestination);
  // A covered native list retains metadata and its scroll extent, never detail prose.
  const { accessVersion, canAccess } = useGeneratedReportAccess(
    active,
    ownership,
    invalidate,
    abort,
    retainedList,
  );
  const list = useCallback(
    async (append = false) => {
      if (!canAccess()) return;
      const last = append ? rows.at(-1) : undefined;
      if (append && !last) return;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      const current = () =>
        request.current === controller &&
        !controller.signal.aborted &&
        canAccess();
      if (append) {
        setPagination('loading');
      } else {
        setExpanded(true);
        setSelected(null);
        setDetail(null);
        setPagination('idle');
        setState('loading');
      }
      try {
        const reader = await open();
        if (!current()) return;
        const page = await reader.list(
          last ? { createdAt: last.createdAt, key: last.key } : undefined,
        );
        if (!current()) return;
        setRows(previous => (append ? [...previous, ...page] : page));
        setPagination(
          page.length === 20 ? 'ready' : append ? 'complete' : 'idle',
        );
        if (!append) setState('ready');
      } catch {
        if (!current()) return;
        if (append) setPagination('failed');
        else setState('failed');
      }
    },
    [canAccess, open, rows],
  );
  useEffect(() => {
    if (!destination || state !== 'idle' || !canAccess()) return;
    let live = true;
    Promise.resolve().then(() => {
      if (live && !request.current && canAccess()) list();
    });
    return () => {
      live = false;
    };
  }, [accessVersion, active, canAccess, destination, list, state]);
  async function read(row: GeneratedReportRow) {
    if (!canAccess()) return;
    // Opening an existing report wins over a page still in flight.
    setPagination(previous => (previous === 'loading' ? 'ready' : previous));
    if (onOpenDestination) {
      abort();
      onOpenDestination(row);
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const selectedGeneration = ++generation.current;
    setSelected(row);
    setDetail(null);
    setState('loading');
    try {
      const reader = await open();
      if (controller.signal.aborted || !canAccess()) return;
      const result = await reader.read(row, controller.signal);
      if (controller.signal.aborted || !canAccess()) return;
      setDetail(
        result
          ? { value: result, owner: controller, generation: selectedGeneration }
          : null,
      );
      setState(result ? 'ready' : 'unavailable');
    } catch {
      if (!controller.signal.aborted && canAccess()) setState('failed');
    }
  }
  if (!retainedList && (!active || ownership?.isCurrent() === false))
    return null;
  const ownsRenderedReport = () =>
    Boolean(
      detail &&
      request.current === detail.owner &&
      !detail.owner.signal.aborted &&
      canAccess(),
    );
  const metadataOwner = request.current ?? inactiveOwner.current;
  const ownsMetadata = () =>
    (request.current ?? inactiveOwner.current) === metadataOwner;
  return (
    <GeneratedReportFrame destination={destination} selected={!!selected}>
      {!destination && !expanded ? (
        <AppButton
          testID="generated-report-open"
          title={copy.open}
          onPress={() => {
            list();
          }}
        />
      ) : (
        <>
          {selected || !destination ? (
            <AppButton
              testID={
                selected ? 'generated-report-back' : 'generated-report-close'
              }
              title={selected ? copy.back : copy.close}
              variant="neutral"
              onPress={() => {
                if (selected) {
                  request.current?.abort();
                  setSelected(null);
                  setDetail(null);
                  setState('ready');
                } else invalidate();
              }}
            />
          ) : null}
          {selected ? (
            <AppText accessibilityRole="header">{copy[selected.kind]}</AppText>
          ) : (
            <GeneratedReportDescription destination={destination} />
          )}
          {state === 'loading' && (
            <AppText accessibilityLiveRegion="polite">{copy.loading}</AppText>
          )}
          {state === 'failed' ? (
            <>
              <AppText accessibilityRole="alert">{copy.failed}</AppText>
              <AppButton
                title={copy.retry}
                onPress={() => {
                  if (selected) read(selected);
                  else list();
                }}
              />
            </>
          ) : null}
          {state === 'unavailable' && (
            <AppText accessibilityRole="alert">{copy.unavailable}</AppText>
          )}
          {selected && detail && state === 'ready' ? (
            <>
              <GeneratedReportContent detail={detail.value} />
              {detail.value.bookmarkOriginal ? (
                <GeneratedReportBookmarkAction
                  key={detail.generation}
                  bookmark={detail.value.bookmarkOriginal}
                  current={ownsRenderedReport}
                />
              ) : null}
            </>
          ) : null}
          {!selected && state === 'ready' ? (
            <GeneratedReportRows
              rows={rows}
              pagination={pagination}
              onOpen={row => {
                if (ownsMetadata()) return read(row);
              }}
              onMore={() => {
                if (ownsMetadata() && ['ready', 'failed'].includes(pagination))
                  return list(true);
              }}
            />
          ) : null}
        </>
      )}
    </GeneratedReportFrame>
  );
}
