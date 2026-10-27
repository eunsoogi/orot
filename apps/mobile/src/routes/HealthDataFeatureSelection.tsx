import { Pressable, StyleSheet, View } from 'react-native';
import type { HealthKitAutoSyncFeature } from '../healthkit/autoSyncCheckpoint';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';

const availableFeatures: readonly HealthKitAutoSyncFeature[] = [
  'medications',
  'bloodPressure',
  'sleep',
  'heartRate',
  'steps',
  'bodyMass',
];

/** Renders compact category choices while leaving saved state with the settings route. */
export function HealthDataFeatureSelection({
  selected,
  disabled,
  onToggle,
}: {
  readonly selected: ReadonlySet<HealthKitAutoSyncFeature>;
  readonly disabled: boolean;
  readonly onToggle: (feature: HealthKitAutoSyncFeature) => void;
}) {
  return (
    <View style={styles.card}>
      {availableFeatures.map((feature, index) => (
        <View key={feature}>
          {index > 0 ? <View style={styles.divider} /> : null}
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{
              checked: selected.has(feature),
              disabled,
            }}
            disabled={disabled}
            onPress={() => onToggle(feature)}
            style={styles.row}
            testID={`health-data-feature-${feature}`}
          >
            <View style={styles.label}>
              <Text style={styles.rowTitle}>
                {t(`healthkit.unifiedImport.feature.${feature}`)}
              </Text>
              <Text
                style={styles.rowStatus}
                testID={`health-data-feature-status-${feature}`}
              >
                {selected.has(feature)
                  ? t('settings.healthData.autoSyncEnabled')
                  : t('settings.healthData.autoSyncDisabled')}
              </Text>
            </View>
            <AppSymbol
              color={
                selected.has(feature) ? appColors.primary : appColors.secondary
              }
              name={selected.has(feature) ? 'checkmark.circle.fill' : 'circle'}
              size={22}
            />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    paddingHorizontal: 16,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: appColors.border,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 68,
    paddingVertical: 10,
  },
  label: { flex: 1, gap: 3, minWidth: 0 },
  rowTitle: { color: appColors.text, fontSize: 15, fontWeight: '500' },
  rowStatus: { color: appColors.secondary, fontSize: 12, lineHeight: 18 },
});
