import { AppButton } from '../layout/AppButton';
import { t } from '../i18n';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';

/** Save and close preserve the editor's own validation and draft boundary. */
export function ManualHistoryFormActions({
  saving,
  isCorrection,
  onSave,
  onClose,
}: {
  saving: boolean;
  isCorrection: boolean;
  onSave: () => Promise<void>;
  onClose: () => void;
}) {
  const save = saving
    ? t('manualHistory.form.saving')
    : isCorrection
      ? t('manualHistory.form.saveCorrection')
      : t('manualHistory.form.save');
  const close = t('manualHistory.form.close');
  const hasDock = useNavigationRouteActions([
    {
      id: 'save-history',
      label: save,
      accessibilityLabel: save,
      testID: 'manual-history-save',
      busy: saving,
      systemImageName: 'checkmark',
      disabled: saving,
      onPress: onSave,
    },
    {
      id: 'close-history',
      label: close,
      accessibilityLabel: close,
      testID: 'manual-history-form-close',
      systemImageName: 'xmark',
      disabled: saving,
      onPress: onClose,
    },
  ]);
  if (hasDock) return null;
  return (
    <>
      <AppButton
        disabled={saving}
        onPress={onSave}
        testID="manual-history-save"
        title={save}
      />
      <AppButton
        variant="secondary"
        disabled={saving}
        onPress={onClose}
        testID="manual-history-form-close"
        title={close}
      />
    </>
  );
}
