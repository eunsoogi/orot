import { View } from 'react-native';
import { healthKitFeatures } from '../types';
import { AppText as Text } from '../../layout/AppText';
import type { HealthKitImportScreenCopy } from './HealthKitImportScreen';
import type { UnifiedImportProgress } from './types';
import { unifiedImportStyles as styles } from './unifiedImportStyles';

/** Reports provider outcomes apart from the controls that define the user's source scope. */
export function HealthKitImportActivity({
  copy,
  progress,
}: {
  readonly copy: HealthKitImportScreenCopy;
  readonly progress: UnifiedImportProgress | null;
}) {
  const selectedOutcomes = healthKitFeatures.flatMap(feature => {
    const outcome = progress?.features[feature];
    return outcome && outcome.status !== 'notSelected'
      ? [{ feature, outcome }]
      : [];
  });
  if (selectedOutcomes.length === 0) return null;

  return (
    <View style={styles.card} testID="unified-import-healthkit-outcomes">
      {selectedOutcomes.map(({ feature, outcome }) => (
        <View key={feature} style={styles.outcome}>
          <Text style={styles.sectionTitle}>{copy.featureNames[feature]}</Text>
          <Text
            style={styles.status}
            testID={`unified-import-feature-status-${feature}`}
          >
            {copy.featureStatuses[outcome.status]}
          </Text>
          {outcome.importedCount !== null && outcome.deletedCount !== null ? (
            <Text style={styles.status}>
              {copy.changeSummary(outcome.importedCount, outcome.deletedCount)}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
