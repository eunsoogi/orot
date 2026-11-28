import type { ReactNode } from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { providerSettingsStyles as styles } from '../layout/providerSettingsPresentation';
import { VoiceCatalogAccount } from './VoiceCatalogAccount';
import { OpenAiVoiceCatalogStatus } from './OpenAiVoiceCatalogStatus';
import type { useVoiceCatalog } from './useVoiceCatalog';
import { VoiceSettingsUnavailablePccOption } from './VoiceSettingsUnavailablePccOption';

/** The saved provider owns display order. Draft taps do not move the controls. */
export function VoiceModelGroups({
  api,
  apiFirst,
  catalog,
  onOpenAccounts,
  local,
}: {
  readonly api: ReactNode;
  readonly apiFirst: boolean;
  readonly local: ReactNode;
  readonly catalog: ReturnType<typeof useVoiceCatalog>;
  readonly onOpenAccounts?: () => void;
}) {
  const localSection = (
    <View key="local" style={styles.section} testID="voice-model-group-local">
      <Text accessibilityRole="header" style={styles.heading}>
        Apple
      </Text>
      {local}
      <VoiceSettingsUnavailablePccOption />
    </View>
  );
  const apiSection = (
    <View
      key="api"
      style={styles.section}
      testID="voice-model-group-openai-api"
    >
      <Text accessibilityRole="header" style={styles.heading}>
        OpenAI API
      </Text>
      <VoiceCatalogAccount catalog={catalog} onOpenAccounts={onOpenAccounts}>
        {api}
        <OpenAiVoiceCatalogStatus catalog={catalog} />
      </VoiceCatalogAccount>
    </View>
  );
  return (
    <>{apiFirst ? [apiSection, localSection] : [localSection, apiSection]}</>
  );
}
