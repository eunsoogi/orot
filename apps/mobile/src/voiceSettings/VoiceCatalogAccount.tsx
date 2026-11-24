import type { ReactNode } from 'react';
import { View } from 'react-native';
import { providerSettingsStyles } from '../layout/providerSettingsPresentation';
import { t } from '../i18n';
import { ApiCatalogAccount } from '../providers/selection/ApiCatalogAccount';
import type { useVoiceCatalog } from './useVoiceCatalog';

/** Match Calendar: one provider surface owns the account header and catalog rows.
 * Each child owns its own inset, so this card does not add padding. */
export function VoiceCatalogAccount({
  catalog,
  children,
  onOpenAccounts,
}: {
  readonly children?: ReactNode;
  readonly catalog: ReturnType<typeof useVoiceCatalog>;
  readonly onOpenAccounts?: () => void;
}) {
  return (
    <View
      style={providerSettingsStyles.catalogAccount}
      testID="voice-openai-catalog-card"
    >
      <ApiCatalogAccount
        connected={catalog.connected}
        busy={catalog.busy}
        refresh={() => {
          catalog.refresh();
        }}
        refreshLabel={t('modelSettings.refreshVoice')}
        testIDPrefix="voice"
        onOpenAccounts={onOpenAccounts}
      />
      {children}
    </View>
  );
}
