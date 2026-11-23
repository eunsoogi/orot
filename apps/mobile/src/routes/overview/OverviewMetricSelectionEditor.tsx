import { Pressable, StyleSheet, View } from 'react-native';
import { AppButton } from '../../layout/AppButton';
import { AppSymbol } from '../../layout/AppSymbol';
import { AppText as Text } from '../../layout/AppText';
import { appColors } from '../../layout/appColors';
import { t } from '../../i18n';
import { overviewMetrics, type OverviewMetric } from './metricSelection';
import { useOverviewMetricDrag } from './useOverviewMetricDrag';
import { overviewMetricStyles as styles } from './overviewMetricStyles';

/** Separates selection from reordering so a handle gesture never toggles its metric. */
export function OverviewMetricSelectionEditor({
  canSave,
  onCancel,
  onMove,
  onSave,
  onToggle,
  saveError,
  saving,
  selection,
  title,
}: {
  readonly canSave: boolean;
  readonly onCancel: () => void;
  readonly onMove: (metric: OverviewMetric, index: number) => void;
  readonly onSave: () => void;
  readonly onToggle: (metric: OverviewMetric) => void;
  readonly saveError: boolean;
  readonly saving: boolean;
  readonly selection: readonly OverviewMetric[];
  readonly title: (metric: OverviewMetric) => string;
}) {
  const drag = useOverviewMetricDrag(selection, saving, onMove);
  const choices = [
    ...selection,
    ...overviewMetrics.filter(metric => !selection.includes(metric)),
  ];
  return (
    <View
      style={styles.selectionPanel}
      testID="overview-metric-selection-editor"
    >
      <Text style={styles.selectionPrompt}>{t('overview.metricChoose')}</Text>
      {choices.map((metric, index) => {
        const selected = index < selection.length;
        const preview = drag.preview;
        const dragging = preview?.metric === metric;
        const destination = preview?.target === index && !dragging;
        return (
          <View
            key={metric}
            onLayout={event => drag.measure(metric, event.nativeEvent.layout)}
            style={dragging && reorderStyles.dragged}
            testID={`overview-metric-choice-${metric}`}
          >
            {index > 0 ? <View style={styles.selectionDivider} /> : null}
            <View
              style={[
                reorderStyles.row,
                dragging && [
                  reorderStyles.dragSurface,
                  { transform: [{ translateY: preview.delta }] },
                ],
              ]}
            >
              <Pressable
                accessibilityLabel={title(metric)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected, disabled: saving }}
                disabled={saving}
                onPress={() => !drag.isActive() && onToggle(metric)}
                style={[styles.selectionRow, reorderStyles.checkbox]}
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
              {selected && selection.length > 1 ? (
                <View
                  accessible
                  accessibilityActions={[
                    ...(index > 0
                      ? [
                          {
                            name: 'decrement',
                            label: t('overview.metricMoveUp'),
                          },
                        ]
                      : []),
                    ...(index < selection.length - 1
                      ? [
                          {
                            name: 'increment',
                            label: t('overview.metricMoveDown'),
                          },
                        ]
                      : []),
                  ]}
                  accessibilityHint={t('overview.metricReorderHint')}
                  accessibilityLabel={t('overview.metricReorder', {
                    metric: title(metric),
                  })}
                  accessibilityRole="adjustable"
                  accessibilityState={{ disabled: saving }}
                  accessibilityValue={{
                    text: t('overview.metricReorderPosition', {
                      position: index + 1,
                      total: selection.length,
                    }),
                  }}
                  collapsable={false}
                  onAccessibilityAction={({ nativeEvent: { actionName } }) => {
                    if (saving || drag.isActive()) return;
                    if (actionName === 'decrement' && index > 0)
                      onMove(metric, index - 1);
                    if (
                      actionName === 'increment' &&
                      index < selection.length - 1
                    )
                      onMove(metric, index + 1);
                  }}
                  onStartShouldSetResponder={() => !saving}
                  onResponderGrant={event => drag.begin(metric, event)}
                  onResponderMove={drag.move}
                  onTouchStart={event => {
                    if (event.nativeEvent.touches.length > 1) drag.finish();
                  }}
                  onResponderRelease={drag.release}
                  onResponderTerminate={drag.finish}
                  onResponderTerminationRequest={() => !drag.isActive()}
                  style={reorderStyles.handle}
                  testID={`overview-metric-reorder-${metric}`}
                >
                  <AppSymbol
                    name="line.3.horizontal"
                    size={18}
                    color={appColors.secondary}
                  />
                </View>
              ) : null}
              {destination ? (
                <View
                  pointerEvents="none"
                  testID="overview-metric-reorder-target"
                  style={[
                    reorderStyles.target,
                    preview.delta < 0
                      ? reorderStyles.targetBefore
                      : reorderStyles.targetAfter,
                  ]}
                />
              ) : null}
            </View>
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
            onPress={() => !drag.isActive() && onSave()}
            testID="overview-metric-selection-save"
          />
        </View>
      </View>
    </View>
  );
}

const reorderStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  checkbox: { flex: 1, minWidth: 0 },
  handle: {
    alignSelf: 'stretch',
    minHeight: 44,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dragged: { zIndex: 1 },
  dragSurface: { backgroundColor: appColors.surface },
  target: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: appColors.primary,
  },
  targetBefore: { top: 0 },
  targetAfter: { bottom: 0 },
});
