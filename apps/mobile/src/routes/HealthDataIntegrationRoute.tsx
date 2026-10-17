import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { HealthKitAutoSyncFeature } from '../healthkit/autoSyncCheckpoint';
import {
  configureLocalHealthKitAutoSync,
  loadLocalHealthKitAutoSyncSelection,
} from '../healthkit/autoSyncLocal';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { HealthDataFeatureSelection } from './HealthDataFeatureSelection';

/** Lets users choose local HealthKit categories that refresh automatically. */
export function HealthDataIntegrationRoute({
  loadSelection = loadLocalHealthKitAutoSyncSelection,
  saveSelection = configureLocalHealthKitAutoSync,
}: {
  readonly loadSelection?: () => Promise<readonly HealthKitAutoSyncFeature[]>;
  readonly saveSelection?: (
    features: readonly HealthKitAutoSyncFeature[],
  ) => Promise<{ readonly status: 'complete' | 'retryable' | 'skipped' }>;
}) {
  const inset = useNavigationContentInset();
  const [selected, setSelected] = useState<
    ReadonlySet<HealthKitAutoSyncFeature>
  >(new Set());
  const [saved, setSaved] = useState<ReadonlySet<HealthKitAutoSyncFeature>>(
    new Set(),
  );
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<
    'complete' | 'retryable' | 'skipped' | null
  >(null);
  const [revision, setRevision] = useState(0);

  async function load() {
    setLoadFailed(false);
    setLoaded(false);
    try {
      const features = await loadSelection();
      const next = new Set(features);
      setSelected(next);
      setSaved(next);
      setLoaded(true);
    } catch {
      setLoadFailed(true);
    }
  }

  useEffect(() => {
    let active = true;
    loadSelection()
      .then(features => {
        if (!active) return;
        const next = new Set(features);
        setSelected(next);
        setSaved(next);
        setLoaded(true);
      })
      .catch(() => active && setLoadFailed(true));
    return () => {
      active = false;
    };
  }, [loadSelection]);

  const dirty = !sameSelection(selected, saved);
  useNavigationLeaveStateRegistration({
    canLeave: !saving,
    hasUnsavedChanges: dirty,
    isRecording: false,
    hasOngoingOperation: saving,
    revision,
    inputRevision: revision,
  });

  function toggle(feature: HealthKitAutoSyncFeature) {
    setNotice(null);
    setRevision(value => value + 1);
    setSelected(current => {
      const next = new Set(current);
      if (next.has(feature)) next.delete(feature);
      else next.add(feature);
      return next;
    });
  }

  async function save() {
    if (!loaded || saving) return;
    setSaving(true);
    setNotice(null);
    const features = [...selected];
    try {
      const result = await saveSelection(features);
      setNotice(result.status);
      setSaved(new Set(features));
    } catch {
      setNotice('retryable');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.container, inset]}
      style={styles.scroll}
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
        onToggle={toggle}
        selected={selected}
      />
      <Text style={styles.note}>{t('settings.healthData.localOnly')}</Text>
      <Text style={styles.note}>{t('settings.healthData.permissionNote')}</Text>
      {loadFailed ? (
        <View style={styles.errorGroup}>
          <Text
            accessibilityRole="alert"
            style={styles.error}
            testID="health-data-load-error"
          >
            {t('settings.healthData.loadError')}
          </Text>
          <AppButton
            onPress={() => void load()}
            testID="health-data-load-retry"
            title={t('appointments.retry')}
            variant="secondary"
          />
        </View>
      ) : null}
      <AppButton
        accessibilityState={{ busy: saving }}
        disabled={!loaded || saving}
        onPress={() => void save()}
        testID="health-data-save"
        title={
          saving
            ? t('settings.healthData.saving')
            : t('settings.healthData.save')
        }
      />
      <Text
        accessibilityLiveRegion="polite"
        style={styles.status}
        testID="health-data-status"
      >
        {notice === 'complete'
          ? t('settings.healthData.saved')
          : notice === 'retryable'
            ? t('settings.healthData.retryable')
            : notice === 'skipped'
              ? t('settings.healthData.disabled')
              : !loaded && !loadFailed
                ? t('settings.healthData.loading')
                : ''}
      </Text>
    </ScrollView>
  );
}

function sameSelection(
  left: ReadonlySet<HealthKitAutoSyncFeature>,
  right: ReadonlySet<HealthKitAutoSyncFeature>,
): boolean {
  return (
    left.size === right.size && [...left].every(feature => right.has(feature))
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: {
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
