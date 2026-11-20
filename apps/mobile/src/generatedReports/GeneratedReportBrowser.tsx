import { GeneratedReportContent } from './GeneratedReportContent';
import { useEffect, useRef, useState } from 'react';
import { AppState, View, StyleSheet } from 'react-native';
import { AppText } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { appColors } from '../layout/appColors';
import { formatDateTime } from '../i18n';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import { openGeneratedReportReader } from './readers';
import { generatedReportCopy as copy } from './text';
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
}: {
  readonly active?: boolean;
  readonly open?: () => Promise<GeneratedReportReader>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<readonly GeneratedReportRow[]>([]);
  const [selected, setSelected] = useState<GeneratedReportRow | null>(null);
  const [detail, setDetail] = useState<GeneratedReportDetail | null>(null);
  const [state, setState] = useState<
    'idle' | 'loading' | 'ready' | 'failed' | 'unavailable'
  >('idle');
  const [more, setMore] = useState(false);
  const request = useRef<AbortController | null>(null);
  const foreground = useRef(AppState.currentState === 'active');
  const available = useRef(active);
  available.current = active;
  function invalidate() {
    request.current?.abort();
    request.current = null;
    setDetail(null);
    setSelected(null);
    setRows([]);
    setState('idle');
    setExpanded(false);
  }
  useEffect(() => {
    const clear = subscribeLocalDataClear(invalidate),
      deleted = subscribeLocalSourceDeletion(invalidate);
    const subscription = AppState.addEventListener('change', next => {
      foreground.current = next === 'active';
      if (!foreground.current) invalidate();
    });
    return () => {
      request.current?.abort();
      clear();
      deleted();
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    if (!active) invalidate();
  }, [active]);
  async function list(append = false) {
    if (!available.current || !foreground.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setExpanded(true);
    setSelected(null);
    setDetail(null);
    setState('loading');
    try {
      const reader = await open();
      const last = append ? rows.at(-1) : undefined;
      const page = await reader.list(
        last ? { createdAt: last.createdAt, key: last.key } : undefined,
      );
      if (controller.signal.aborted || !available.current) return;
      setRows(append ? [...rows, ...page] : page);
      setMore(page.length === 20);
      setState('ready');
    } catch {
      if (!controller.signal.aborted && available.current) setState('failed');
    }
  }
  async function read(row: GeneratedReportRow) {
    if (!available.current || !foreground.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setSelected(row);
    setDetail(null);
    setState('loading');
    try {
      const reader = await open();
      const result = await reader.read(row, controller.signal);
      if (controller.signal.aborted || !available.current) return;
      setDetail(result);
      setState(result ? 'ready' : 'unavailable');
    } catch {
      if (!controller.signal.aborted && available.current) setState('failed');
    }
  }
  if (!active) return null;
  return (
    <View style={styles.panel} testID="generated-report-browser">
      <AppText accessibilityRole="header" style={styles.heading}>
        {copy.title}
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
          {selected ? (
            <AppText accessibilityRole="header">{copy[selected.kind]}</AppText>
          ) : (
            <AppText>{copy.description}</AppText>
          )}
          {state === 'loading' ? (
            <AppText accessibilityLiveRegion="polite">{copy.loading}</AppText>
          ) : null}
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
          {state === 'unavailable' ? (
            <AppText accessibilityRole="alert">{copy.unavailable}</AppText>
          ) : null}
          {selected && detail && state === 'ready' ? (
            <GeneratedReportContent detail={detail} />
          ) : null}
          {!selected && state === 'ready' ? (
            <>
              {rows.length === 0 ? (
                <AppText>{copy.empty}</AppText>
              ) : (
                rows.map(row => (
                  <AppButton
                    key={row.key}
                    testID={`generated-report-${row.key}`}
                    variant="list"
                    title={copy[row.kind]}
                    summary={`${formatDateTime(new Date(row.createdAt))}${row.unavailable ? ' · ' + copy.unavailable : ''}`}
                    onPress={() => {
                      read(row);
                    }}
                  />
                ))
              )}
              {more ? (
                <AppButton
                  title={copy.more}
                  onPress={() => {
                    list(true);
                  }}
                />
              ) : null}
            </>
          ) : null}
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: {
    gap: 12,
    padding: 16,
    backgroundColor: appColors.surface,
    borderRadius: 16,
  },
  heading: { fontSize: 20, fontWeight: '600' },
});
