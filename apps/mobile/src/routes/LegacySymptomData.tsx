import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import type { RecordRepository, SymptomEntry } from '@orot/storage';
import {
  pendingSymptomDeletions,
  removeLegacySymptom,
} from './legacySymptomDeletion';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { formatDateTime } from '../i18n';

export interface LegacySymptomStore {
  list(): Promise<SymptomEntry[]>;
  pending(): Promise<string[]>;
  delete(id: string): Promise<boolean>;
}

async function openLegacySymptomStore(): Promise<LegacySymptomStore> {
  const { openLocalStorage } = await import('../storage/secureDatabase');
  const records = await openLocalStorage();
  return createLegacySymptomStore(records, async id => {
    const [{ openLocalAgentMemoryDatabase }, { createLocalE5RagService }] =
      await Promise.all([
        import('../storage/secureDatabase'),
        import('../rag/localE5RagService'),
      ]);
    const rag = createLocalE5RagService(await openLocalAgentMemoryDatabase());
    await rag.prepare();
    return removeLegacySymptom(records, rag, id);
  });
}

/** Uses the same deletion boundary as all other personal records. */
export function createLegacySymptomStore(
  records: RecordRepository,
  remove: (id: string) => Promise<boolean>,
): LegacySymptomStore {
  return {
    list: () => records.list('symptom_entry'),
    pending: () => pendingSymptomDeletions(records),
    delete: remove,
  };
}

/** Retains access to old source data without restoring entry or editing. */
export function LegacySymptomData({
  openStore = openLegacySymptomStore,
}: {
  readonly openStore?: () => Promise<LegacySymptomStore>;
}) {
  const [entries, setEntries] = useState<readonly SymptomEntry[] | null>(null);
  const [pending, setPending] = useState<readonly string[]>([]);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const deleting = useRef(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    let active = true;
    setError(false);
    openStore()
      .then(async store => Promise.all([store.list(), store.pending()]))
      .then(([result, pendingIds]) => {
        if (active) {
          setEntries(result);
          setPending(pendingIds);
          if (pendingIds.length) setExpanded(true);
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [openStore, revision]);

  const remove = async (id: string) => {
    if (deleting.current) return;
    deleting.current = true;
    setBusy(true);
    setError(false);
    try {
      const store = await openStore();
      // The store fences derived evidence before removing its source.
      await store.delete(id);
      setEntries(current => current?.filter(entry => entry.id !== id) ?? null);
      setPending(current => current.filter(value => value !== id));
      reload();
    } catch {
      setError(true);
      const store = await openStore().catch(() => null);
      if (store) setPending(await store.pending().catch(() => []));
    } finally {
      deleting.current = false;
      setBusy(false);
    }
  };
  const confirm = (id: string) =>
    Alert.alert(
      '이전 증상 데이터 삭제',
      '이 데이터를 사용한 저장된 AI 결과가 삭제될 수 있어요. 출처를 구분할 수 없는 AI 메모리는 보관하되 사용을 제한해요. 삭제할까요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => remove(id),
        },
      ],
    );

  if (!error && (!entries || entries.length === 0)) return null;
  return (
    <View style={styles.section} testID="legacy-symptom-data">
      <Text accessibilityRole="header" style={styles.title}>
        이전 증상 데이터
      </Text>
      <Text>이전에 저장한 데이터를 확인하거나 삭제할 수 있어요.</Text>
      {error && (
        <Text accessibilityRole="alert">
          데이터를 불러오거나 삭제하지 못했어요.
        </Text>
      )}
      {error && <AppButton title="다시 시도" onPress={reload} />}
      {entries && entries.length > 0 && (
        <AppButton
          title={expanded ? '접기' : '데이터 보기'}
          onPress={() => setExpanded(value => !value)}
          testID="legacy-symptom-toggle"
        />
      )}
      {expanded &&
        entries?.map(entry => (
          <View
            key={entry.id}
            style={styles.record}
            testID={`legacy-symptom-${entry.id}`}
          >
            <Text>{entry.description}</Text>
            {pending.includes(entry.id) && (
              <Text accessibilityRole="alert">
                삭제가 완료되지 않았어요. 아래 버튼으로 삭제를 다시 시도해
                주세요.
              </Text>
            )}
            {entry.bodySite && <Text>부위: {entry.bodySite}</Text>}
            <Text>시작: {formatDateTime(new Date(entry.effectiveAt))}</Text>
            <Text>기록: {formatDateTime(new Date(entry.recordedAt))}</Text>
            <Text>
              상태: {entry.status === 'active' ? '진행 중' : '해소됨'}
            </Text>
            {entry.resolvedAt && (
              <Text>해소: {formatDateTime(new Date(entry.resolvedAt))}</Text>
            )}
            {entry.severity !== undefined && (
              <Text>강도: {entry.severity}/10</Text>
            )}
            <AppButton
              title="삭제"
              accessibilityLabel={`이전 증상 데이터 삭제: ${entry.description}`}
              disabled={busy}
              onPress={() => confirm(entry.id)}
            />
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 12,
    padding: 16,
    backgroundColor: appColors.surface,
    borderRadius: 18,
  },
  title: { fontSize: 18, fontWeight: '700', color: appColors.text },
  record: {
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: appColors.border,
    paddingTop: 12,
  },
});
