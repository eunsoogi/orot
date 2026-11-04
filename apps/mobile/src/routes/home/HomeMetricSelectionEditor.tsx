import { Pressable, View } from 'react-native';
import { AppButton } from '../../layout/AppButton';
import { AppSymbol } from '../../layout/AppSymbol';
import { AppText as Text } from '../../layout/AppText';
import { appColors } from '../../layout/appColors';
import { t } from '../../i18n';
import { homeMetrics, type HomeMetric } from './metricSelection';
import { homeMetricStyles as styles } from './homeMetricStyles';

/** Keeps each metric choice a single accessible checkbox until its draft is saved. */
export function HomeMetricSelectionEditor({
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
  readonly onToggle: (metric: HomeMetric) => void;
  readonly saveError: boolean;
  readonly saving: boolean;
  readonly selection: readonly HomeMetric[];
  readonly title: (metric: HomeMetric) => string;
}) {
  return (
    <View style={styles.selectionPanel} testID="home-metric-selection-editor">
      <Text style={styles.selectionPrompt}>{t('home.metricChoose')}</Text>
      {homeMetrics.map((metric, index) => {
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
              testID={`home-metric-selection-${metric}`}
            >
              <View style={styles.selectionLabel}>
                <Text style={styles.selectionTitle}>{title(metric)}</Text>
                <Text
                  style={styles.selectionStatus}
                  testID={`home-metric-selection-status-${metric}`}
                >
                  {selected
                    ? t('home.metricSelectedStatus')
                    : t('home.metricUnselectedStatus')}
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
        <Text accessibilityRole="alert">{t('home.metricSaveError')}</Text>
      ) : null}
      <View
        style={styles.selectionActions}
        testID="home-metric-selection-actions"
      >
        <View
          style={styles.selectionActionSlot}
          testID="home-metric-selection-cancel-slot"
        >
          <AppButton
            title={t('home.metricCancel')}
            variant="secondary"
            disabled={saving}
            onPress={onCancel}
            testID="home-metric-selection-cancel"
          />
        </View>
        <View
          style={styles.selectionActionSlot}
          testID="home-metric-selection-save-slot"
        >
          <AppButton
            title={t('home.metricSave')}
            variant="primary"
            disabled={saving || !canSave}
            busy={saving}
            onPress={onSave}
            testID="home-metric-selection-save"
          />
        </View>
      </View>
    </View>
  );
}
