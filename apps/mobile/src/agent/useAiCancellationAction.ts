import { t } from '../i18n';
import { useNavigationPrimaryAction } from '../navigation/useNavigationPrimaryAction';

/** Publishes the active request's cancel control beside Back and Home, above the keyboard. */
export function useAiCancellationAction(
  busy: boolean,
  onCancel: () => void,
  testID: string,
): boolean {
  const label = t('aiActivity.cancel');
  return useNavigationPrimaryAction(
    busy
      ? { label, accessibilityLabel: label, testID, onPress: onCancel }
      : undefined,
  );
}
