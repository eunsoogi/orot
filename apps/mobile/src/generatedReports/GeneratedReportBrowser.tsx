import { GeneratedReportBookmarkAction } from './GeneratedReportBookmarkAction';
import { GeneratedReportContent } from './GeneratedReportContent';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { AppState, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { t } from '../i18n';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import { openGeneratedReportReader } from './readers';
import { generatedReportCopy as copy } from './text';
import { GeneratedReportRows } from './GeneratedReportRows';
import { generatedReportBrowserStyles as styles } from './generatedReportBrowserStyles';
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
}: {
  readonly active?: boolean;
  readonly open?: () => Promise<GeneratedReportReader>;
  readonly destination?: boolean;
  readonly ownership?: NavigationRouteOwnership;
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
  const [more, setMore] = useState(false);
  const request = useRef<AbortController | null>(null);
  const foreground = useRef(AppState.currentState === 'active');
  const available = useRef(active);
  available.current = active;
  const firstEntry = useRef(destination);
  const canAccess = useCallback(
    () =>
      available.current &&
      foreground.current &&
      (ownership?.isCurrent() ?? true),
    [ownership],
  );
  function invalidate() {
    firstEntry.current = false;
    request.current?.abort();
    request.current = null;
    setDetail(null);
    setSelected(null);
    setRows([]);
    setState('idle');
    setExpanded(false);
  }
  useLayoutEffect(() => {
    const clear = subscribeLocalDataClear(invalidate),
      deleted = subscribeLocalSourceDeletion(invalidate);
    const leave = ownership?.subscribe(() => {
      if (!ownership.isCurrent()) invalidate();
    });
    const subscription = AppState.addEventListener('change', next => {
      foreground.current = next === 'active';
      if (!foreground.current) invalidate();
    });
    return () => {
      request.current?.abort();
      leave?.();
      clear();
      deleted();
      subscription.remove();
    };
  }, [ownership]);
  const list = useCallback(
    async (append = false) => {
      if (!canAccess()) return;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setExpanded(true);
      setSelected(null);
      setDetail(null);
      setState('loading');
      try {
        const reader = await open();
        if (controller.signal.aborted || !canAccess()) return;
        const last = append ? rows.at(-1) : undefined;
        const page = await reader.list(
          last ? { createdAt: last.createdAt, key: last.key } : undefined,
        );
        if (controller.signal.aborted || !canAccess()) return;
        setRows(append ? [...rows, ...page] : page);
        setMore(page.length === 20);
        setState('ready');
      } catch {
        if (!controller.signal.aborted && canAccess()) setState('failed');
      }
    },
    [canAccess, open, rows],
  );
  useEffect(() => {
    if (!active) invalidate();
  }, [active]);
  useEffect(() => {
    if (!active || !firstEntry.current) return;
    let live = true;
    // Defer the first read so a replayed effect cannot consume route entry.
    Promise.resolve().then(() => {
      if (!live || !firstEntry.current || !canAccess()) return;
      firstEntry.current = false;
      list();
    });
    return () => {
      live = false;
    };
  }, [active, canAccess, list]);
  async function read(row: GeneratedReportRow) {
    if (!canAccess()) return;
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
  if (!active || (ownership && !ownership.isCurrent())) return null;
  // A newly selected instance of the same report cannot revive this press.
  const ownsRenderedReport = () =>
    Boolean(
      detail &&
      request.current === detail.owner &&
      !detail.owner.signal.aborted &&
      canAccess() &&
      AppState.currentState === 'active',
    );
  return (
    <View style={styles.panel} testID="generated-report-browser">
      <AppText accessibilityRole="header" style={styles.heading}>
        {destination ? t('records.generatedConversationMaterials') : copy.title}
      </AppText>
      {!expanded ? (
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
            <AppText>{copy.description}</AppText>
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
              more={more}
              onOpen={read}
              onMore={() => list(true)}
            />
          ) : null}
        </>
      )}
    </View>
  );
}
