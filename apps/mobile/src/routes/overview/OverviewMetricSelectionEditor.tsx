import { Pressable, View } from 'react-native';
import { AppButton } from '../../layout/AppButton';
import { AppSymbol } from '../../layout/AppSymbol';
import { AppText as Text } from '../../layout/AppText';
import { appColors } from '../../layout/appColors';
import { t } from '../../i18n';
import { overviewMetrics, type OverviewMetric } from './metricSelection';
import { overviewMetricStyles as styles } from './overviewMetricStyles';

/** Keeps each metric choice a single accessible checkbox until its draft is saved. */
export function OverviewMetricSelectionEditor({
  canSave,
  onCancel,
  onSave,
  onToggle,
  saveError,
  saving,
  selection,
  title,
}: {
  readonly canSave: boolean;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly onToggle: (metric: OverviewMetric) => void;
  readonly saveError: boolean;
  readonly saving: boolean;
  readonly selection: readonly OverviewMetric[];
  readonly title: (metric: OverviewMetric) => string;
}) {
  return (
    <View
      style={styles.selectionPanel}
      testID="overview-metric-selection-editor"
    >
      <Text style={styles.selectionPrompt}>{t('overview.metricChoose')}</Text>
      {overviewMetrics.map((metric, index) => {
        const selected = selection.includes(metric);
        return (
          <View key={metric}>
            {index > 0 ? <View style={styles.selectionDivider} /> : null}
            <Pressable
              accessibilityLabel={title(metric)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected, disabled: saving }}
              disabled={saving}
              onPress={() => onToggle(metric)}
              style={styles.selectionRow}
              testID={`overview-metric-selection-${metric}`}
            >
              <View style={styles.selectionLabel}>
                <Text style={styles.selectionTitle}>{title(metric)}</Text>
                <Text
                  style={styles.selectionStatus}
                  testID={`overview-metric-selection-status-${metric}`}
                >
                  {selected
                    ? t('overview.metricSelectedStatus')
                    : t('overview.metricUnselectedStatus')}
                </Text>
              </View>
              <View
                style={[
                  styles.selectionMark,
                  selected && styles.selectionMarkSelected,
                ]}
              >
                {selected ? (
                  <AppSymbol name="checkmark" size={14} color="#000000" />
                ) : (
                  <AppSymbol
                    name="circle"
                    size={24}
                    color={appColors.secondary}
                  />
                )}
              </View>
            </Pressable>
          </View>
        );
      })}
      {saveError ? (
        <Text accessibilityRole="alert">{t('overview.metricSaveError')}</Text>
      ) : null}
      <View
        style={styles.selectionActions}
        testID="overview-metric-selection-actions"
      >
        <View
          style={styles.selectionActionSlot}
          testID="overview-metric-selection-cancel-slot"
        >
          <AppButton
            title={t('overview.metricCancel')}
            variant="secondary"
            disabled={saving}
            onPress={onCancel}
            testID="overview-metric-selection-cancel"
          />
        </View>
        <View
          style={styles.selectionActionSlot}
          testID="overview-metric-selection-save-slot"
        >
          <AppButton
            title={t('overview.metricSave')}
            variant="primary"
            disabled={saving || !canSave}
            busy={saving}
            onPress={onSave}
            testID="overview-metric-selection-save"
          />
        </View>
      </View>
    </View>
  );
}
