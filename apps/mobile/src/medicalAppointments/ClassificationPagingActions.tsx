import { Pressable, StyleSheet, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { AppButton } from '../layout/AppButton';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';

/** Fixed touch targets keep paging reachable when Dynamic Type leaves a short text viewport. */
export function ClassificationPagingActions(props: {
  readonly previousDisabled: boolean;
  readonly nextDisabled: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly compact: boolean;
  readonly actionTitle: string;
  readonly actionLabel: string;
  readonly disabled?: boolean;
  readonly onAction: () => void;
  readonly supplementaryAction?: {
    readonly title: string;
    readonly onPress: () => void;
  };
}) {
  return (
    <View style={styles.row}>
      <IconAction
        name="chevron.left"
        label={t('medicalAppointments.previousResult')}
        disabled={props.previousDisabled}
        onPress={props.onPrevious}
        testID="medical-appointment-previous-result"
      />
      {props.compact ? (
        <View style={styles.action}>
          <IconAction
            name="arrow.right"
            label={props.actionLabel}
            disabled={props.disabled}
            onPress={props.onAction}
            testID="medical-appointment-import"
          />
        </View>
      ) : (
        <AppButton
          title={props.actionTitle}
          accessibilityLabel={props.actionLabel}
          onPress={props.onAction}
          disabled={props.disabled}
          testID="medical-appointment-import"
          titleNumberOfLines={1}
          style={styles.action}
        />
      )}
      {props.supplementaryAction ? (
        <IconAction
          name="gearshape"
          label={props.supplementaryAction.title}
          onPress={props.supplementaryAction.onPress}
          testID="medical-appointment-calendar-settings"
        />
      ) : null}
      <IconAction
        name="chevron.right"
        label={t('medicalAppointments.nextResult')}
        disabled={props.nextDisabled}
        onPress={props.onNext}
        testID="medical-appointment-next-result"
      />
    </View>
  );
}
function IconAction(props: {
  readonly name: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      testID={props.testID}
      style={[styles.icon, props.disabled && styles.disabled]}
    >
      <AppSymbol name={props.name} size={20} color={appColors.primaryText} />
    </Pressable>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  action: { flex: 1, minWidth: 0 },
  icon: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
});
