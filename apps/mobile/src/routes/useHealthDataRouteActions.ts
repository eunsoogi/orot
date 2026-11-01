import { t } from '../i18n';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';

/** Keep selection save and initial-load recovery tied to the same settings state. */
export function useHealthDataRouteActions({
  loadFailed,
  loaded,
  saving,
  onRetryLoad,
  onSave,
}: {
  loadFailed: boolean;
  loaded: boolean;
  saving: boolean;
  onRetryLoad: () => void;
  onSave: () => void;
}) {
  const save = saving
    ? t('settings.healthData.saving')
    : t('settings.healthData.save');
  const retry = t('appointments.retry');
  return useNavigationRouteActions([
    ...(loadFailed
      ? [
          {
            id: 'retry-health-data-load',
            label: retry,
            accessibilityLabel: retry,
            testID: 'health-data-load-retry',
            systemImageName: 'arrow.clockwise',
            onPress: onRetryLoad,
          },
        ]
      : []),
    {
      id: 'save-health-data',
      label: save,
      accessibilityLabel: save,
      testID: 'health-data-save',
      systemImageName: 'checkmark',
      disabled: !loaded || saving,
      busy: saving,
      onPress: onSave,
    },
  ]);
}
