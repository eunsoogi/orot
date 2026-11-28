import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { AppText as Text } from '../layout/AppText';
import {
  modelSettingsPageGap,
  providerCatalogContentInset,
  providerSettingsStyles as shared,
} from '../layout/providerSettingsPresentation';

/** Keep the provider account control visible while its exact catalog is not eligible.
 * Presentation never fetches a catalog or inherits a prior account's selected models. */
export function OpenAiVoicePairForm({
  visible,
  speech,
  preferences,
  tools,
}: {
  readonly visible: boolean;
  readonly speech: ReactNode;
  readonly preferences: ReactNode;
  readonly tools: ReactNode;
}) {
  if (!visible) return null;
  return (
    <View style={styles.form} testID="openai-voice-pair-form">
      <View style={styles.rows} testID="openai-voice-speech">
        <Text accessibilityRole="header" style={[shared.heading, styles.title]}>
          {t('modelSettings.voiceTab')}
        </Text>
        {speech}
      </View>
      <View testID="openai-voice-preferences">{preferences}</View>
      <View style={styles.rows} testID="openai-voice-tools">
        <Text accessibilityRole="header" style={[shared.heading, styles.title]}>
          {t('modelSettings.liveResponsesTitle')}
        </Text>
        {tools}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: modelSettingsPageGap,
    paddingBottom: providerCatalogContentInset,
  },
  rows: { gap: modelSettingsPageGap },
  title: { marginHorizontal: providerCatalogContentInset },
});
