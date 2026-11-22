import { useContext } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { formatDateTime } from '../i18n';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { NavigationMotionContext } from '../navigation/NavigationMotionContext';
import { GeneratedReportBookmarkAction } from './GeneratedReportBookmarkAction';
import { GeneratedReportContent } from './GeneratedReportContent';
import { generatedReportCopy } from './text';
import type { GeneratedReportDetail, GeneratedReportRow } from './types';

export type GeneratedReportDetailPresentationState =
  | { readonly status: 'loading' | 'failed' | 'unavailable' }
  | {
      readonly status: 'ready';
      readonly detail: GeneratedReportDetail;
      readonly generation: number;
    };

const detailCopy = {
  body: '저장된 내용',
  recordedAt: (value: string) => `기록 시각: ${value}`,
  origin: {
    conversation: '보관 위치: 대화',
    summary: '보관 위치: 저장된 분석',
    visit: '보관 위치: 저장된 진료 질문',
  } satisfies Record<GeneratedReportRow['origin'], string>,
  loading: '이 자료를 불러오는 중이에요.',
  failed: '이 자료를 불러오지 못했어요.',
  unavailable: '현재 열 수 없는 자료예요.',
} as const;

/** One readable column inside the route's existing scroll owner. Metadata is
 * shown during loading, but only an exact ready detail can mount report content.
 * The route owns permission, retry, insets and the only Back control.
 */
export function GeneratedReportDetailPresentation({
  row,
  state,
  onRetry,
  isCurrent,
}: {
  readonly row: GeneratedReportRow;
  readonly state: GeneratedReportDetailPresentationState;
  readonly onRetry: () => void;
  readonly isCurrent: () => boolean;
}) {
  const reduceMotion = useContext(NavigationMotionContext);
  const created = new Date(row.createdAt);
  return (
    <View testID="generated-material-detail" style={styles.reader}>
      <View style={styles.header}>
        <AppText
          accessibilityRole="header"
          style={styles.title}
          testID="generated-material-detail-title"
        >
          {generatedReportCopy[row.kind]}
        </AppText>
        <View
          testID="generated-material-detail-metadata"
          style={styles.metadata}
        >
          {Number.isFinite(created.getTime()) ? (
            <AppText style={styles.metadataText}>
              {detailCopy.recordedAt(formatDateTime(created))}
            </AppText>
          ) : null}
          <AppText style={styles.metadataText}>
            {detailCopy.origin[row.origin]}
          </AppText>
        </View>
      </View>
      {state.status === 'ready' ? (
        <>
          <View style={styles.body}>
            <AppText accessibilityRole="header" style={styles.sectionTitle}>
              {detailCopy.body}
            </AppText>
            <GeneratedReportContent detail={state.detail} />
          </View>
          {state.detail.bookmarkOriginal ? (
            <View style={styles.actions}>
              <GeneratedReportBookmarkAction
                key={`${row.key}:${state.generation}`}
                bookmark={state.detail.bookmarkOriginal}
                current={isCurrent}
              />
            </View>
          ) : null}
        </>
      ) : state.status === 'loading' ? (
        <View testID="generated-material-detail-loading" style={styles.loading}>
          {!reduceMotion ? (
            <ActivityIndicator
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              size="small"
              color={appColors.primaryText}
              testID="generated-material-detail-progress"
            />
          ) : null}
          <AppText
            accessibilityLiveRegion="polite"
            accessibilityState={{ busy: true }}
            style={styles.loadingText}
          >
            {detailCopy.loading}
          </AppText>
        </View>
      ) : state.status === 'failed' ? (
        <View style={styles.status}>
          <AppText accessibilityRole="alert" style={styles.statusTitle}>
            {detailCopy.failed}
          </AppText>
          <AppButton
            testID="generated-report-detail-retry"
            title={generatedReportCopy.retry}
            variant="secondary"
            size="compact"
            style={styles.retry}
            onPress={onRetry}
          />
        </View>
      ) : (
        <View style={styles.status}>
          <AppText accessibilityRole="alert" style={styles.statusTitle}>
            {detailCopy.unavailable}
          </AppText>
          <AppText style={styles.description}>
            {generatedReportCopy.unavailable}
          </AppText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  reader: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 720,
    gap: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
  },
  header: {
    gap: 10,
    borderBottomColor: appColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 18,
  },
  title: { color: appColors.text, fontSize: 28, fontWeight: '700' },
  metadata: { gap: 4 },
  metadataText: { color: appColors.secondary, fontSize: 14 },
  body: { gap: 12 },
  sectionTitle: { color: appColors.text, fontSize: 18, fontWeight: '700' },
  actions: {
    borderTopColor: appColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
  },
  loading: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
  loadingText: { color: appColors.secondary, flex: 1, minWidth: 0 },
  status: { gap: 10 },
  statusTitle: { color: appColors.text, fontSize: 17, fontWeight: '600' },
  description: { color: appColors.secondary },
  retry: { alignSelf: 'flex-start', maxWidth: '100%' },
});
