import { useNavigationLeaveStateRegistration } from '../navigation';
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
  // Read-only detail owns no unsaved operation; native Back must remain available while loading.
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });
  const { rows, state, refresh } = useSavedMemories(load, active);
  const row = rows.find(value => value.id === memoryId);
  return (
    <View style={styles.section} testID="saved-memory-detail">
      <Text accessibilityRole="header" style={styles.title}>
        {t('savedMemory.detailTitle')}
      </Text>
      {state === 'loading' && (
        <Text accessibilityLiveRegion="polite">{t('savedMemory.loading')}</Text>
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
      {row && (
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
            {row.provenance.reviewState === 'user_confirmed'
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
