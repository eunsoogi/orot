import { SavedConversationAnswerDetail } from './SavedConversationAnswerDetail';
import { SavedGeneratedReportDetail } from './SavedGeneratedReportDetail';
import { SavedMemoryContent } from './SavedMemoryContent';
import { useNavigationRouteRefresh } from '../navigation/navigationRouteRefresh';
import { useNavigationLeaveStateRegistration } from '../navigation';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { useState } from 'react';
import { HistoryMemoryDetail } from './HistoryMemoryDetail';
import {
  isConversationAnswerMemory,
  isGeneratedReportMemory,
  isHistoryMemory,
} from './unifiedSavedMemories';
import { View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { t } from '../i18n';
import { useSavedMemories, type SavedMemory } from './useSavedMemories';
import { savedMemoryStyles as styles } from './savedMemoryStyles';
/** The native destination reloads its ID through the same foreground/deletion fences as the list. */
export function SavedMemoryDetail({
  memoryId,
  active = true,
  ownership,
  load,
}: {
  readonly active?: boolean;
  readonly memoryId?: string;
  readonly ownership?: NavigationRouteOwnership;
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
  const {
    rows,
    state,
    refresh,
    refreshReadOnly,
    readOnlyRefreshing,
    readyRead,
  } = useSavedMemories(load, active, ownership, selectedId);
  const row = rows.find(value => value.id === selectedId);
  // Editable history and generated reports retain their own detail lifecycles.
  const isPlainMemory =
    row &&
    !isHistoryMemory(row) &&
    !isGeneratedReportMemory(row) &&
    !isConversationAnswerMemory(row);
  useNavigationRouteRefresh(
    active &&
      (Boolean(isPlainMemory || (row && isConversationAnswerMemory(row))) ||
        readOnlyRefreshing),
    refreshReadOnly,
  );
  return (
    <View
      style={[styles.section, styles.detail, styles.readingDetail]}
      testID="saved-memory-detail"
    >
      {(!row || !isHistoryMemory(row)) && <ReadOnlyMemoryNavigation />}
      <Text accessibilityRole="header" style={styles.detailTitle}>
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
      {readyRead && row && isGeneratedReportMemory(row) && (
        <SavedGeneratedReportDetail
          key={JSON.stringify([readyRead.request, row.id])}
          artifactId={row.artifactId}
          reportKind={row.reportKind}
          isReadCurrent={readyRead.isCurrent}
        />
      )}
      {readyRead && row && isConversationAnswerMemory(row) && (
        <SavedConversationAnswerDetail
          key={JSON.stringify([readyRead.request, row.id])}
          artifactId={row.artifactId}
          isReadCurrent={readyRead.isCurrent}
        />
      )}
      {row &&
        !isHistoryMemory(row) &&
        !isGeneratedReportMemory(row) &&
        !isConversationAnswerMemory(row) && <SavedMemoryContent memory={row} />}
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
