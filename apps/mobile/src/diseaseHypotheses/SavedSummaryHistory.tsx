import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { AppText } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import type { DiseaseHypothesisAnalysis } from './types';
import type {
  SavedSummaryListItem,
  SymptomSummaryHistory,
} from './savedSummaries';

/** History reads only ten metadata rows at a time; opening a row loads one saved result without AI calls. */
export function SavedSummaryHistory({
  history,
  current,
  disabled,
  expanded,
  onRestore,
}: {
  readonly history: SymptomSummaryHistory;
  readonly current?: DiseaseHypothesisAnalysis['savedSummary'];
  readonly disabled: boolean;
  readonly expanded: boolean;
  readonly onRestore: (value: DiseaseHypothesisAnalysis) => void;
}) {
  const [rows, setRows] = useState<readonly SavedSummaryListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const revision = current?.status === 'saved' ? current.id : undefined;
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    setLoading(true);
    history
      .list()
      .then(page => {
        if (!active) return;
        setRows(page);
        setHasMore(page.length === 10);
        setError(false);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [history, revision, reload, expanded]);
  async function read(id: string) {
    if (busy || disabled) return;
    setBusy(true);
    setError(false);
    try {
      const result = await history.read(id);
      // Back may remove this history scene while encrypted storage is still reading.
      if (!mounted.current) return;
      if (!result) throw new Error('Saved summary unavailable.');
      onRestore(result);
    } catch {
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  // A hidden history panel must not introduce another empty flex gap in the summary form.
  if (!current && !expanded && !error) return null;
  return (
    <View style={{ gap: 8 }} testID="symptom-summary-history">
      {current?.status === 'saved' ? (
        <AppText testID="symptom-summary-saved">
          저장됨 · {new Date(current.createdAt).toLocaleString('ko-KR')} ·{' '}
          {current.modelName}
        </AppText>
      ) : null}
      {current?.status === 'saved' && current.sourceChanged ? (
        <AppText accessibilityRole="alert">
          생성 당시의 요약이에요. 일부 원본이 바뀌어 근거를 다시 확인해야 해요.
        </AppText>
      ) : null}
      {current?.status === 'saved'
        ? current.contentReviewIssues?.map(issue => (
            <AppText
              key={issue}
              accessibilityRole="alert"
              testID={`summary-content-review-${issue}`}
            >
              {issue === 'prescription'
                ? '이 요약의 처방 여부 표현은 다시 확인이 필요해요. 약의 일정 등록만으로 처방 여부를 알 수는 없어요.'
                : issue === 'sleep_count'
                  ? '이 요약의 수면 횟수 표현은 다시 확인이 필요해요. 수면 단계 값은 횟수가 아니에요.'
                  : issue === 'sleep_duration'
                    ? '이 요약의 수면 구간 길이는 원문과 맞지 않을 수 있어요. 원문의 시작·종료 시각을 확인해 주세요.'
                    : '이 요약의 걸음 수 단위는 다시 확인이 필요해요. 걸음 수를 횟수로 읽지 않도록 원문을 확인해 주세요.'}
            </AppText>
          ))
        : null}
      {current?.status === 'failed' ? (
        <>
          <AppText accessibilityRole="alert">
            요약을 기기에 저장하지 못했어요. 다시 저장해 주세요.
          </AppText>
          <AppButton
            title="다시 저장"
            variant="secondary"
            disabled={disabled || busy}
            onPress={async () => {
              setBusy(true);
              try {
                const result = await history.retrySave?.();
                if (result) onRestore(result);
                else setError(true);
              } catch {
                setError(true);
              } finally {
                setBusy(false);
              }
            }}
          />
        </>
      ) : null}
      {error ? (
        <>
          <AppText accessibilityRole="alert">
            저장된 요약을 불러오지 못했어요.
          </AppText>
          <AppButton
            title="다시 불러오기"
            variant="secondary"
            disabled={disabled || busy}
            onPress={() => setReload(value => value + 1)}
          />
        </>
      ) : null}
      {expanded ? (
        <>
          {loading ? <AppText>저장된 요약을 불러오고 있어요.</AppText> : null}
          {rows.length === 0 && !error && !loading ? (
            <AppText>저장된 요약이 없어요.</AppText>
          ) : null}
          {rows.map(row => (
            <AppButton
              key={row.id}
              variant="secondary"
              title={`${new Date(row.createdAt).toLocaleString('ko-KR')} · ${row.modelName}`}
              disabled={disabled || busy}
              onPress={() => {
                void read(row.id);
              }}
            />
          ))}
          {hasMore ? (
            <AppButton
              title="이전 요약 더 보기"
              variant="secondary"
              disabled={busy || disabled}
              onPress={async () => {
                setBusy(true);
                try {
                  const next = await history.list(rows[rows.length - 1]?.id);
                  setRows(items => [...items, ...next]);
                  setHasMore(next.length === 10);
                } catch {
                  setError(true);
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : null}
        </>
      ) : null}
    </View>
  );
}
