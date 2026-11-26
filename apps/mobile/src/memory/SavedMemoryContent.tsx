import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { formatDateTime, t } from '../i18n';
import type { AgentSavedMemory } from './unifiedSavedMemories';

/** Present the exact stored text, never parse it into newer facts or invent source-opening actions. */
export function SavedMemoryContent({ memory }: { memory: AgentSavedMemory }) {
  const { fontScale } = useWindowDimensions();
  if (memory.unavailableReason && !memory.historicalSnapshot)
    return (
      <AppText
        accessibilityRole="alert"
        style={styles.unavailable}
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
        {memory.historicalSnapshot && (
          <View style={styles.context} testID="saved-memory-historical-context">
            <AppText style={styles.contextText}>
              {t('savedMemory.historicalSnapshot')}
            </AppText>
          </View>
        )}
        <AppText
          selectable={!memory.historicalSnapshot}
          style={styles.body}
          testID="saved-memory-verbatim"
        >
          {memory.text}
        </AppText>
      </View>
      <View style={styles.metadata} testID="saved-memory-metadata">
        <AppText accessibilityRole="header" style={styles.heading}>
          {t('savedMemory.metadataTitle')}
        </AppText>
        <View
          style={[
            styles.metadataGroups,
            fontScale > 1.3 && styles.largeTextGroups,
          ]}
          testID="saved-memory-metadata-groups"
        >
          <View
            style={
              fontScale <= 1.3 ? styles.metadataGroup : styles.stackedGroup
            }
          >
            <AppText style={styles.kind}>{kind}</AppText>
            <AppText style={styles.detail}>
              {t('savedMemory.savedAt', {
                date: formatDateTime(new Date(memory.createdAt)),
              })}
            </AppText>
          </View>
          <View
            style={
              fontScale <= 1.3 ? styles.metadataGroup : styles.stackedGroup
            }
          >
            <AppText style={styles.kind}>{review}</AppText>
            {!memory.historicalSnapshot && (
              <AppText style={styles.detail}>
                {t('savedMemory.sourceCount', {
                  count: memory.provenance.sourceIds.length,
                })}
              </AppText>
            )}
          </View>
        </View>
      </View>
    </>
  );
}
const styles = StyleSheet.create({
  content: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 16,
    minWidth: 0,
    padding: 20,
  },
  context: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    backgroundColor: appColors.background,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  contextText: {
    color: appColors.text,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
  },
  heading: {
    color: appColors.text,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 23,
  },
  // Unbounded text follows Dynamic Type and wraps in the native route's scroll lane.
  body: { fontSize: 19, lineHeight: 31, color: appColors.text },
  metadata: {
    borderTopColor: appColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
    paddingHorizontal: 4,
    paddingTop: 16,
  },
  // Basis is a preferred lane, not a minimum: narrow split views still wrap.
  metadataGroups: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  largeTextGroups: { flexDirection: 'column', flexWrap: 'nowrap' },
  metadataGroup: {
    flexBasis: 200,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    gap: 3,
  },
  stackedGroup: { minWidth: 0, gap: 3 },
  kind: {
    fontSize: 15,
    lineHeight: 23,
    color: appColors.text,
    fontWeight: '600',
  },
  detail: { fontSize: 14, lineHeight: 21, color: appColors.secondary },
  unavailable: { fontSize: 17, lineHeight: 26, color: appColors.text },
});
