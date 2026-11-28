import { t } from '../../i18n';
import { navigationText } from '../../i18n/navigation';
import { AppButton as Button } from '../../layout/AppButton';
import { AppText as Text } from '../../layout/AppText';
import { PageHeading } from '../../layout/PageHeading';
import { providerSelectionScreenStyles as styles } from './providerSelectionScreenPresentation';
import { providerSelectionText } from './text';

/** Settings titles share the tab's heading scale; the embedded picker retains its own. */
export function ProviderSelectionHeading({
  isSettings,
  introduction,
  title,
  onBack,
}: {
  readonly isSettings: boolean;
  readonly introduction?: string;
  readonly title?: string;
  readonly onBack?: () => void;
}) {
  return (
    <>
      {onBack ? (
        <Button
          accessibilityLabel={navigationText.back.accessibilityLabel}
          onPress={onBack}
          testID="provider-selection-back"
          title={navigationText.back.label}
        />
      ) : null}
      {isSettings ? (
        <PageHeading>{title ?? providerSelectionText.title}</PageHeading>
      ) : (
        <Text accessibilityRole="header" style={styles.title}>
          {t('modelSettings.languageTitle')}
        </Text>
      )}
      <Text style={styles.introduction}>
        {isSettings
          ? (introduction ?? providerSelectionText.introduction)
          : t('modelSettings.languagePrompt')}
      </Text>
    </>
  );
}
