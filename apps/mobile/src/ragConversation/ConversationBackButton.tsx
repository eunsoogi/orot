import { AppButton } from '../layout/AppButton';
import { navigationText } from '../i18n/navigation';

/** Standalone conversation entry retains the standard Back action. */
export function ConversationBackButton({ onBack }: { onBack: () => void }) {
  return (
    <AppButton
      accessibilityLabel={navigationText.back.accessibilityLabel}
      onPress={onBack}
      title={navigationText.back.label}
    />
  );
}
