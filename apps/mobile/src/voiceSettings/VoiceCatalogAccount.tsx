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
          accessibilityLabel="OpenAI API 계정 정보"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(value => !value)}
          testID="voice-account-details"
        >
          <Text style={styles.title}>OpenAI API</Text>
          <Text style={styles.secondary}>
            {catalog.connected ? 'API 계정 연결됨' : 'API 계정 연결 필요'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="음성 모델 새로고침"
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
          title="OpenAI API 연결 관리"
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
