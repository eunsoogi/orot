import { t } from '../i18n';
import { AppText as Text } from '../layout/AppText';
import { providerSettingsStyles as styles } from '../layout/providerSettingsPresentation';
import { liveModel } from './liveVoicePreferences';
import type { useVoiceCatalog } from './useVoiceCatalog';

export function OpenAiVoiceCatalogStatus({
  catalog,
}: {
  catalog: ReturnType<typeof useVoiceCatalog>;
}) {
  const emptyTools =
    catalog.fresh &&
    catalog.ids.includes(liveModel) &&
    catalog.toolIds.length === 0;
  const message = emptyTools
    ? t('modelSettings.liveResponsesCatalogEmpty')
    : catalog.message;
  return message && message !== t('modelSettings.refreshAccountModels') ? (
    <Text accessibilityRole="status" style={styles.secondary}>
      {message}
    </Text>
  ) : null;
}
