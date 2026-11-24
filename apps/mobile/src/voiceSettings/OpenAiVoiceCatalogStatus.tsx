import { StyleSheet } from 'react-native';
import { t } from '../i18n';
import { AppText as Text } from '../layout/AppText';
import {
  providerCatalogContentInset,
  providerSettingsStyles as shared,
} from '../layout/providerSettingsPresentation';
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
    <Text accessibilityRole="status" style={[shared.secondary, styles.footer]}>
      {message}
    </Text>
  ) : null;
}

const styles = StyleSheet.create({
  // The shared card has no padding; inset only the footer so rows keep their widths.
  footer: {
    paddingHorizontal: providerCatalogContentInset,
    paddingTop: 4,
    paddingBottom: providerCatalogContentInset,
  },
});
