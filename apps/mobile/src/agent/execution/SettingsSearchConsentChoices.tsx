import { View, Switch } from 'react-native';
import { AppText } from '../../layout/AppText';
import { t } from '../../i18n';
import type { SettingsSearchChoices } from './settingsSearchGrants';

/** Search opt-ins start off and identify destinations separately from the text model. */
export function SettingsSearchConsentChoices({
  value,
  onChange,
  webRecipient,
  disabled,
}: {
  value: SettingsSearchChoices;
  onChange: (value: SettingsSearchChoices) => void;
  webRecipient?: string;
  disabled: boolean;
}) {
  const row = (key: keyof SettingsSearchChoices, copy: string) => (
    <View key={key}>
      <AppText>{copy}</AppText>
      <Switch
        value={value[key]}
        onValueChange={checked => {
          if (!disabled) onChange({ ...value, [key]: checked });
        }}
        accessibilityLabel={copy}
        disabled={disabled}
        testID={`settings-consent-${key}`}
      />
    </View>
  );
  return (
    <View testID="settings-search-consent-choices">
      {webRecipient
        ? row('web', t('modelSettings.consentWeb', { recipient: webRecipient }))
        : null}
      {row('medical', t('modelSettings.consentMedical'))}
    </View>
  );
}
