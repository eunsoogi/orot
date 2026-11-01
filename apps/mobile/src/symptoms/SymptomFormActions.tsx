import { Keyboard, Platform, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { t } from '../i18n';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';
import SymptomKeyboardAccessoryGroup from './SymptomKeyboardAccessoryGroup';
import { formKeyboardFields } from './symptomFormKeyboard';
import styles from './SymptomForm.styles';

/** Page and real keyboard actions share the same save and cancellation boundary. */
export default function SymptomFormActions({
  mode,
  saving,
  needsStatus,
  onSave,
  onCancel,
}: {
  readonly mode: 'create' | 'edit';
  readonly saving: boolean;
  readonly needsStatus: boolean;
  readonly onSave: () => Promise<void>;
  readonly onCancel: () => void;
}) {
  const title =
    mode === 'edit'
      ? t('symptoms.journal.form.saveChanges')
      : t('symptoms.journal.form.save');
  const disabled = saving || needsStatus;
  const close = t('symptoms.journal.form.close');
  const saveLabel = saving ? t('symptoms.journal.form.saving') : title;
  const hasDock = useNavigationRouteActions([
    {
      id: 'save-symptom',
      label: saveLabel,
      accessibilityLabel: saveLabel,
      testID: 'symptom-save',
      busy: saving,
      systemImageName: 'checkmark',
      disabled,
      onPress: onSave,
    },
    {
      id: 'cancel-symptom',
      label: close,
      accessibilityLabel: close,
      testID: 'symptom-form-cancel',
      systemImageName: 'xmark',
      disabled: saving,
      onPress: onCancel,
    },
  ]);
  return (
    <View style={styles.form}>
      {!hasDock ? (
        <AppButton
          disabled={disabled}
          onPress={() => {
            onSave();
          }}
          testID="symptom-save"
          title={saving ? t('symptoms.journal.form.saving') : title}
        />
      ) : null}
      {!hasDock ? (
        <AppButton
          disabled={saving}
          onPress={onCancel}
          testID="symptom-form-cancel"
          title={t('symptoms.journal.form.close')}
          variant="secondary"
        />
      ) : null}
      {Platform.OS === 'ios' && !hasDock ? (
        <SymptomKeyboardAccessoryGroup
          actions={[
            {
              label: title,
              testID: 'symptom-keyboard-save',
              disabled,
              onPress: () => {
                Keyboard.dismiss();
                onSave();
              },
            },
            {
              label: t('symptoms.journal.form.close'),
              testID: 'symptom-keyboard-close',
              disabled: saving,
              onPress: () => {
                Keyboard.dismiss();
                onCancel();
              },
            },
          ]}
          fields={formKeyboardFields(mode)}
        />
      ) : null}
    </View>
  );
}
