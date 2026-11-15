import { t } from '../i18n';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppButton as Button } from '../layout/AppButton';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { providerSettingsStyles as styles } from '../layout/providerSettingsPresentation';
import { OpenAIProviderMark } from '../providers/selection/OpenAIProviderMark';
import type { useVoiceCatalog } from './useVoiceCatalog';

/** A compact API account header matches the language catalog without initiating authentication. */
export function VoiceCatalogAccount({
  catalog,
  onOpenAccounts,
}: {
  readonly catalog: ReturnType<typeof useVoiceCatalog>;
  readonly onOpenAccounts?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={local.container}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <OpenAIProviderMark />
        </View>
        <Pressable
          style={styles.copy}
          accessibilityRole="button"
          accessibilityLabel={t('modelSettings.apiAccountInfo')}
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(value => !value)}
          testID="voice-account-details"
        >
          <Text style={styles.title}>OpenAI API</Text>
          <Text style={styles.secondary}>
            {catalog.connected
              ? t('modelSettings.apiConnected')
              : t('modelSettings.apiRequired')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('modelSettings.refreshVoice')}
          accessibilityState={{
            busy: catalog.busy,
            disabled: catalog.busy || !catalog.connected,
          }}
          style={styles.action}
          testID="voice-model-refresh"
          disabled={catalog.busy || !catalog.connected}
          onPress={() => {
            catalog.refresh();
          }}
        >
          <AppSymbol
            name="arrow.triangle.2.circlepath"
            size={18}
            color={appColors.primary}
          />
        </Pressable>
      </View>
      {expanded ? (
        <Button
          title={t('modelSettings.manageApi')}
          variant="text"
          onPress={onOpenAccounts}
          disabled={!onOpenAccounts}
          testID="voice-open-accounts"
        />
      ) : null}
    </View>
  );
}

const local = StyleSheet.create({ container: { padding: 10, gap: 8 } });
