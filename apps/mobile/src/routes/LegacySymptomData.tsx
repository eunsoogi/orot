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
import { formatDateTime, t } from '../i18n';

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
      t('legacySymptom.deleteTitle'),
      t('legacySymptom.deleteNotice'),
      [
        { text: t('legacySymptom.cancel'), style: 'cancel' },
        {
          text: t('legacySymptom.delete'),
          style: 'destructive',
          onPress: () => remove(id),
        },
      ],
    );

  if (!error && (!entries || entries.length === 0)) return null;
  return (
    <View style={styles.section} testID="legacy-symptom-data">
      <Text accessibilityRole="header" style={styles.title}>
        {t('legacySymptom.title')}
      </Text>
      <Text>{t('legacySymptom.description')}</Text>
      {error && (
        <Text accessibilityRole="alert">{t('legacySymptom.error')}</Text>
      )}
      {error && <AppButton title={t('legacySymptom.retry')} onPress={reload} />}
      {entries && entries.length > 0 && (
        <AppButton
          title={
            expanded ? t('legacySymptom.collapse') : t('legacySymptom.show')
          }
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
                {t('legacySymptom.pending')}
              </Text>
            )}
            {entry.bodySite && (
              <Text>
                {t('legacySymptom.bodySite', { value: entry.bodySite })}
              </Text>
            )}
            <Text>
              {t('legacySymptom.started', {
                value: formatDateTime(new Date(entry.effectiveAt)),
              })}
            </Text>
            <Text>
              {t('legacySymptom.recorded', {
                value: formatDateTime(new Date(entry.recordedAt)),
              })}
            </Text>
            <Text>
              {t('legacySymptom.status', {
                value:
                  entry.status === 'active'
                    ? t('legacySymptom.active')
                    : t('legacySymptom.resolved'),
              })}
            </Text>
            {entry.resolvedAt && (
              <Text>
                {t('legacySymptom.resolvedAt', {
                  value: formatDateTime(new Date(entry.resolvedAt)),
                })}
              </Text>
            )}
            {entry.severity !== undefined && (
              <Text>
                {t('legacySymptom.severity', { value: entry.severity })}
              </Text>
            )}
            <AppButton
              title={t('legacySymptom.delete')}
              accessibilityLabel={t('legacySymptom.deleteLabel', {
                description: entry.description,
              })}
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
