import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { HealthKitAutoSyncFeature } from '../healthkit/autoSyncCheckpoint';
import type { HealthKitAutoSyncNotice } from '../healthkit/autoSyncSettings';
import { t } from '../i18n';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { appColors } from '../layout/appColors';
import { useNavigationEdgeVerticalScroll } from '../navigation/navigationEdgeScroll';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { useHealthDataRouteActions } from './useHealthDataRouteActions';
import { HealthDataAuthorizationRecoveryNotice } from './HealthDataAuthorizationRecoveryNotice';
import { HealthDataFeatureSelection } from './HealthDataFeatureSelection';

/** Keeps choices, and their save feedback in one region-bound scrolling page. */
export function HealthDataIntegrationScreen({
  loadFailed,
  loaded,
  notice,
  onRetryLoad,
  onSave,
  onToggle,
  saving,
  selected,
}: {
  readonly loadFailed: boolean;
  readonly loaded: boolean;
  readonly notice: HealthKitAutoSyncNotice | null;
  readonly onRetryLoad: () => void;
  readonly onSave: () => void;
  readonly onToggle: (feature: HealthKitAutoSyncFeature) => void;
  readonly saving: boolean;
  readonly selected: ReadonlySet<HealthKitAutoSyncFeature>;
}) {
  const inset = useNavigationContentInset();
  const [ownerWidth, setOwnerWidth] = useState(0);
  const edge = useNavigationEdgeVerticalScroll({
    ownerWidth,
    trailingPadding: inset.paddingRight ?? styles.panel.paddingHorizontal,
  });
  const hasDock = useHealthDataRouteActions({
    loadFailed,
    loaded,
    saving,
    onRetryLoad,
    onSave,
  });
  // Consume the shell's scroll clearance once; the measured wrapper owns horizontal regions.
  const page = (
    <ScrollView
      {...edge.indicatorProps}
      contentContainerStyle={[styles.panel, inset, edge.contentStyle]}
      style={[styles.scroll, edge.scrollViewStyle]}
      testID="health-data-scroll"
    >
      <View style={styles.heading}>
        <Text
          accessibilityRole="header"
          style={styles.title}
          testID="health-data-title"
        >
          {t('settings.healthData.title')}
        </Text>
        <Text style={styles.body}>{t('settings.healthData.description')}</Text>
      </View>
      <HealthDataFeatureSelection
        disabled={!loaded || saving}
        onToggle={onToggle}
        selected={selected}
      />
      <Text style={styles.note}>{t('settings.healthData.localOnly')}</Text>
      {loadFailed ? (
        <View style={styles.errorGroup}>
          <Text
            accessibilityRole="alert"
            style={styles.error}
            testID="health-data-load-error"
          >
            {t('settings.healthData.loadError')}
          </Text>
          {!hasDock ? (
            <AppButton
              onPress={onRetryLoad}
              testID="health-data-load-retry"
              title={t('appointments.retry')}
              variant="secondary"
            />
          ) : null}
        </View>
      ) : null}
      {!hasDock ? (
        <AppButton
          accessibilityState={{ busy: saving }}
          disabled={!loaded || saving}
          onPress={() => {
            onSave();
          }}
          testID="health-data-save"
          title={
            saving
              ? t('settings.healthData.saving')
              : t('settings.healthData.save')
          }
        />
      ) : null}
      <Text
        accessibilityLiveRegion="polite"
        style={styles.status}
        testID="health-data-status"
      >
        {notice?.status === 'complete'
          ? t('settings.healthData.saved')
          : notice?.status === 'retryable'
            ? t('settings.healthData.retryable')
            : notice?.status === 'skipped'
              ? t('settings.healthData.disabled')
              : notice?.status === 'selection_save_failed'
                ? t('settings.healthData.selectionSaveFailed')
                : !loaded && !loadFailed
                  ? t('settings.healthData.loading')
                  : ''}
      </Text>
      {notice?.authorizationFailure ? (
        <HealthDataAuthorizationRecoveryNotice
          failure={notice.authorizationFailure}
        />
      ) : null}
    </ScrollView>
  );

  return (
    <AdaptiveColumns
      primary={
        // The adaptive panel can be narrower than the shared scene. Measure before extending.
        <View
          onLayout={event => setOwnerWidth(event.nativeEvent.layout.width)}
          style={styles.scroll}
          testID="health-data-scroll-lane"
        >
          {page}
        </View>
      }
      routeKey="settings-health-data"
      testID="health-data-layout"
    />
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  panel: {
    flexGrow: 1,
    backgroundColor: appColors.background,
    gap: 16,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  heading: { gap: 8 },
  title: { color: appColors.text, fontSize: 30, fontWeight: '700' },
  body: { color: appColors.secondary, fontSize: 15, lineHeight: 22 },
  note: { color: appColors.secondary, fontSize: 13, lineHeight: 19 },
  status: {
    color: appColors.secondary,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 20,
  },
  error: { color: appColors.danger, fontSize: 14, lineHeight: 20 },
  errorGroup: { gap: 8 },
});
