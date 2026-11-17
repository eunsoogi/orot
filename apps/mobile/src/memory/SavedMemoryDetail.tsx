import { useNavigationLeaveStateRegistration } from '../navigation';
import { useState } from 'react';
import { HistoryMemoryDetail } from './HistoryMemoryDetail';
import { isHistoryMemory } from './unifiedSavedMemories';
import { View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { formatDateTime, t } from '../i18n';
import { useSavedMemories, type SavedMemory } from './useSavedMemories';
import { savedMemoryStyles as styles } from './savedMemoryStyles';
const kindLabels = {
  preference: t('savedMemory.preference'),
  reviewed_interaction: t('savedMemory.reviewedInteraction'),
  task_context: t('savedMemory.taskContext'),
};
/** The native destination reloads its ID through the same foreground/deletion fences as the list. */
export function SavedMemoryDetail({
  memoryId,
  active = true,
  load,
}: {
  readonly active?: boolean;
  readonly memoryId?: string;
  readonly load?: () => Promise<SavedMemory[]>;
}) {
  const [correctionTarget, setCorrectionTarget] = useState<{
    original: string | undefined;
    id: string;
  } | null>(null);
  // A reused native route must never render the previous selection while an effect catches up.
  const selectedId =
    correctionTarget && correctionTarget.original === memoryId
      ? correctionTarget.id
      : memoryId;
  const { rows, state, refresh } = useSavedMemories(load, active);
  const row = rows.find(value => value.id === selectedId);
  return (
    <View style={[styles.section, styles.detail]} testID="saved-memory-detail">
      {(!row || !isHistoryMemory(row)) && <ReadOnlyMemoryNavigation />}
      <Text accessibilityRole="header" style={styles.title}>
        {t('savedMemory.detailTitle')}
      </Text>
      {state === 'loading' && (
        <Text accessibilityLiveRegion="polite">{t('savedMemory.loading')}</Text>
      )}
      {state === 'invalidated' && (
        <>
          <Text accessibilityLiveRegion="polite">
            {t('savedMemory.invalidated')}
          </Text>
          <AppButton
            title={t('savedMemory.reload')}
            onPress={() => {
              refresh();
            }}
          />
        </>
      )}
      {state === 'failed' && (
        <>
          <Text accessibilityRole="alert">{t('savedMemory.failed')}</Text>
          <AppButton
            title={t('savedMemory.retry')}
            onPress={() => {
              refresh();
            }}
          />
        </>
      )}
      {state === 'ready' && !row && <Text>{t('savedMemory.notFound')}</Text>}
      {row && isHistoryMemory(row) && (
        <HistoryMemoryDetail
          key={row.id}
          record={row.record}
          onChanged={id => {
            setCorrectionTarget({ original: memoryId, id });
            refresh();
          }}
        />
      )}
      {row && !isHistoryMemory(row) && (
        <>
          <Text style={styles.body} selectable>
            {row.text}
          </Text>
          <Text style={styles.kind}>{kindLabels[row.kind]}</Text>
          <Text style={styles.description}>
            {t('savedMemory.savedAt', {
              date: formatDateTime(new Date(row.createdAt)),
            })}
          </Text>
          <Text style={styles.description}>
            {String(row.provenance.reviewState) === 'user_stated'
              ? t('savedMemory.userStated')
              : row.provenance.reviewState === 'user_confirmed'
                ? t('savedMemory.confirmed')
                : t('savedMemory.reviewed')}{' '}
            {t('savedMemory.sources', {
              count: row.provenance.sourceIds.length,
            })}
          </Text>
        </>
      )}
    </View>
  );
}

function ReadOnlyMemoryNavigation() {
  // Read-only detail owns no unsaved operation; native Back must remain available while loading.
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });
  return null;
}
