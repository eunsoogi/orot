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
            <Text style={styles.rowTitle}>
              {t(`healthkit.unifiedImport.feature.${feature}`)}
            </Text>
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
    justifyContent: 'space-between',
    minHeight: 54,
  },
  rowTitle: { color: appColors.text, fontSize: 15, fontWeight: '500' },
});
