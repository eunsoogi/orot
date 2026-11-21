import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';

/** Text paging preserves every measured result without arrow decorations. */
export function ClassificationPagingActions(props: {
  readonly previousDisabled: boolean;
  readonly nextDisabled: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly showPaging: boolean;
  readonly supplementaryAction?: {
    readonly title: string;
    readonly onPress: () => void;
  };
}) {
  if (!props.showPaging && !props.supplementaryAction) return null;
  return (
    <View style={styles.row}>
      {props.showPaging ? (
        <>
          <TextAction
            label={t('medicalAppointments.previousResult')}
            disabled={props.previousDisabled}
            onPress={props.onPrevious}
            testID="medical-appointment-previous-result"
          />
          <TextAction
            label={t('medicalAppointments.nextResult')}
            disabled={props.nextDisabled}
            onPress={props.onNext}
            testID="medical-appointment-next-result"
          />
        </>
      ) : null}
      {props.supplementaryAction ? (
        <TextAction
          label={props.supplementaryAction.title}
          onPress={props.supplementaryAction.onPress}
          testID="medical-appointment-calendar-settings"
        />
      ) : null}
    </View>
  );
}

function TextAction(props: {
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
      style={[styles.button, props.disabled && styles.disabled]}
    >
      <AppText style={styles.text}>{props.label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  button: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  text: { color: appColors.primaryText, fontSize: 15, textAlign: 'center' },
  disabled: { opacity: 0.4 },
});
