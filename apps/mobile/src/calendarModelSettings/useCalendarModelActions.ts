import { t } from '../i18n';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';

/** The mounted calendar tab owns its sidebar actions; leaving the tab unregisters them. */
export function useCalendarModelActions(
  pending: boolean,
  saving: boolean,
  available: boolean,
  confirm: () => void,
  cancel: () => void,
) {
  return useNavigationRouteActions([
    {
      id: 'confirm-calendar-model',
      label: t('modelSettings.confirmLanguage'),
      accessibilityLabel: t('modelSettings.confirmLanguage'),
      testID: 'provider-selection-confirm',
      systemImageName: 'checkmark',
      disabled: !pending || saving || !available,
      busy: saving,
      onPress: confirm,
    },
    ...(pending
      ? [
          {
            id: 'cancel-calendar-model',
            label: t('provider.selection.cancel'),
            accessibilityLabel: t('provider.selection.cancel'),
            testID: 'provider-selection-cancel',
            systemImageName: 'xmark',
            disabled: saving,
            onPress: cancel,
          },
        ]
      : []),
  ]);
}
