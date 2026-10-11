import { Pressable, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { AppSymbol } from '../../layout/AppSymbol';
import { CheckboxIndicator } from '../../layout/CheckboxIndicator';
import { appColors } from '../../layout/appColors';
import { healthKitFeatures, type HealthKitFeature } from '../types';
import type { HealthKitImportScreenCopy } from './HealthKitImportScreen';
import type { UnifiedImportProgress } from './types';
import { unifiedImportStyles as styles } from './unifiedImportStyles';

/** The provider switch is explicit; individual types remain selectable before the single permission batch. */
export function HealthKitProviderCard({
  copy,
  selected,
  progress,
  disabled,
  onToggle,
  onToggleFeature,
}: {
  readonly copy: HealthKitImportScreenCopy;
  readonly selected: ReadonlySet<HealthKitFeature>;
  readonly progress: UnifiedImportProgress | null;
  readonly disabled: boolean;
  readonly onToggle: () => void;
  readonly onToggleFeature: (feature: HealthKitFeature) => void;
}) {
  const checked =
    selected.size === healthKitFeatures.length
      ? true
      : selected.size === 0
        ? false
        : 'mixed';
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
        accessibilityLabel="건강 앱 기록 선택"
        disabled={disabled}
        onPress={onToggle}
        style={styles.provider}
        testID="unified-import-toggle-healthKit"
      >
        <View style={styles.providerIcon}>
          <AppSymbol name="heart.fill" color={appColors.danger} />
        </View>
        <View style={styles.providerText}>
          <Text style={styles.sectionTitle}>건강 앱</Text>
          <Text style={styles.caption}>가져올 기록을 선택해 주세요.</Text>
        </View>
        <CheckboxIndicator
          checked={checked}
          disabled={disabled}
          testID="unified-import-indicator-healthKit"
        />
      </Pressable>
      <View style={styles.options}>
        {healthKitFeatures.map(feature => {
          const featureChecked = selected.has(feature);
          const outcome = progress?.features[feature];
          return (
            <Pressable
              key={feature}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: featureChecked, disabled }}
              disabled={disabled}
              onPress={() => onToggleFeature(feature)}
              style={[styles.option, featureChecked && styles.selectedOption]}
              testID={`unified-import-toggle-${feature}`}
            >
              <View style={styles.optionHeading}>
                <CheckboxIndicator
                  checked={featureChecked}
                  disabled={disabled}
                  testID={`unified-import-indicator-${feature}`}
                />
                <Text style={styles.optionLabel}>
                  {copy.featureNames[feature]}
                </Text>
              </View>
              {outcome && outcome.status !== 'notSelected' ? (
                <Text
                  style={styles.status}
                  testID={`unified-import-feature-status-${feature}`}
                >
                  {copy.featureStatuses[outcome.status]}
                </Text>
              ) : null}
              {outcome &&
              outcome.importedCount !== null &&
              outcome.deletedCount !== null ? (
                <Text style={styles.status}>
                  {copy.changeSummary(
                    outcome.importedCount,
                    outcome.deletedCount,
                  )}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
