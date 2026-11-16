import { t } from '../i18n';
import { ApiCatalogAccount } from '../providers/selection/ApiCatalogAccount';
import type { useVoiceCatalog } from './useVoiceCatalog';

/** Voice and calendar use the same account presentation without sharing model selection. */
export function VoiceCatalogAccount({
  catalog,
  onOpenAccounts,
}: {
  readonly catalog: ReturnType<typeof useVoiceCatalog>;
  readonly onOpenAccounts?: () => void;
}) {
  return (
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
  );
}
