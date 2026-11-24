import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { t } from '../i18n';
import { AppText as Text } from '../layout/AppText';
import { providerSettingsStyles as styles } from '../layout/providerSettingsPresentation';
import { VoiceCatalogAccount } from './VoiceCatalogAccount';
import { OpenAiVoiceModelTabs } from './OpenAiVoiceModelTabs';

type Props = ComponentProps<typeof VoiceCatalogAccount> &
  ComponentProps<typeof OpenAiVoiceModelTabs>;

/** Keep the shared account/catalog UI outside the local presentation tabs. */
export function OpenAiVoiceModelSection({
  catalog,
  onOpenAccounts,
  ...tabs
}: Props) {
  return (
    <View style={styles.section} testID="voice-model-group-openai-api">
      <Text accessibilityRole="header" style={styles.heading}>
        OpenAI API
      </Text>
      <View style={styles.catalogAccount}>
        <VoiceCatalogAccount
          catalog={catalog}
          onOpenAccounts={onOpenAccounts}
        />
        <OpenAiVoiceModelTabs {...tabs} />
      </View>
      {catalog.fresh &&
      tabs.selected === 'tools' &&
      catalog.toolIds.length === 0 ? (
        <Text accessibilityRole="status" style={styles.secondary}>
          {t('modelSettings.liveResponsesCatalogEmpty')}
        </Text>
      ) : catalog.message &&
        catalog.message !== t('modelSettings.refreshAccountModels') &&
        (tabs.selected === 'speech' || !catalog.fresh) ? (
        <Text accessibilityRole="status" style={styles.secondary}>
          {catalog.message}
        </Text>
      ) : null}
      {!catalog.fresh &&
      (catalog.ids.length > 0 || catalog.toolIds.length > 0) ? (
        <Text style={styles.detail}>{t('modelSettings.staleModels')}</Text>
      ) : null}
    </View>
  );
}
