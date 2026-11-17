import { StyleSheet, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { formatDateTime, t } from '../i18n';
import type { AgentSavedMemory } from './unifiedSavedMemories';

/** Present the exact stored text, never parse it into newer facts or invent source-opening actions. */
export function SavedMemoryContent({ memory }: { memory: AgentSavedMemory }) {
  if (memory.unavailableReason)
    return (
      <AppText
        accessibilityRole="alert"
        testID="saved-memory-parent-unavailable"
      >
        {t('savedMemory.quarantinedParent')} {t('savedMemory.reviewAgain')}
      </AppText>
    );
  const kind = {
    preference: t('savedMemory.preference'),
    reviewed_interaction: t('savedMemory.reviewedInteraction'),
    task_context: t('savedMemory.taskContext'),
  }[memory.kind];
  const review =
    memory.provenance.reviewState === 'user_stated'
      ? t('savedMemory.userStated')
      : memory.provenance.reviewState === 'user_confirmed'
        ? t('savedMemory.confirmed')
        : t('savedMemory.reviewed');
  return (
    <>
      <View style={styles.content} testID="saved-memory-content">
        <AppText style={styles.category}>{kind}</AppText>
        <AppText accessibilityRole="header" style={styles.heading}>
          {t('savedMemory.contentTitle')}
        </AppText>
        <AppText selectable style={styles.body} testID="saved-memory-verbatim">
          {memory.text}
        </AppText>
      </View>
      <View style={styles.metadata} testID="saved-memory-metadata">
        <AppText accessibilityRole="header" style={styles.heading}>
          {t('savedMemory.metadataTitle')}
        </AppText>
        <AppText style={styles.detail}>
          {t('savedMemory.savedAt', {
            date: formatDateTime(new Date(memory.createdAt)),
          })}
        </AppText>
        <View style={styles.provenance}>
          <AppText style={styles.detail}>{review}</AppText>
          <AppText style={styles.detail}>
            {t('savedMemory.sourceCount', {
              count: memory.provenance.sourceIds.length,
            })}
          </AppText>
        </View>
      </View>
    </>
  );
}
const styles = StyleSheet.create({
  content: {
    gap: 12,
    padding: 20,
    borderRadius: 20,
    backgroundColor: appColors.surface,
    minWidth: 0,
  },
  category: {
    fontSize: 14,
    lineHeight: 20,
    color: appColors.primaryText,
    fontWeight: '600',
  },
  heading: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '700',
    color: appColors.text,
  },
  // Preserve 16pt body text and natural full-height wrapping at every Dynamic Type size.
  body: { fontSize: 16, lineHeight: 26, color: appColors.text },
  metadata: { gap: 12, paddingHorizontal: 4, paddingBottom: 8 },
  provenance: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  detail: { fontSize: 16, lineHeight: 24, color: appColors.secondary },
});
