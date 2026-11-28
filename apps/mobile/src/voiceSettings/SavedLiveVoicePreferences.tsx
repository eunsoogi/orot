import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import {
  LiveVoiceCatalogSelect,
  liveVoiceSelectBoxInset,
} from './LiveVoiceCatalogSelect';
import { voiceLabel } from './LiveVoicePreferencesPanel';
import { liveVoiceCatalog } from './liveVoicePreferences';
import type { LiveResponsesSettings } from './liveResponsesSettings';

/** Present only the committed pair's values, never a legacy fallback or an editable draft. */
export function SavedLiveVoicePreferences({
  settings,
}: {
  readonly settings?: Extract<LiveResponsesSettings, { kind: 'active' }>;
}) {
  const [, invalidate] = useState(0);
  useEffect(
    () => settings?.subscribe(() => invalidate(current => current + 1)),
    [settings],
  );
  if (!settings?.current() || !settings.savedPreferences) return null;
  const { language, voice } = settings.savedPreferences;
  const group = liveVoiceCatalog.find(([id]) => id === language);
  const languageLabel = group
    ? t(group[1])
    : t('modelSettings.liveVoiceLanguageAutomatic');
  return (
    <View style={styles.group} testID="live-voice-preferences">
      <LiveVoiceCatalogSelect
        label={t('modelSettings.liveVoiceLanguage')}
        testID="live-voice-language"
        options={[[language, languageLabel]]}
        value={language}
        expanded={false}
        busy
        onToggle={noop}
        onSelect={noop}
      />
      <LiveVoiceCatalogSelect
        label={t('modelSettings.liveVoiceName')}
        testID="live-voice-voice"
        options={[[voice, voiceLabel(voice)]]}
        value={voice}
        expanded={false}
        busy
        onToggle={noop}
        onSelect={noop}
      />
    </View>
  );
}

const noop = () => {};
const styles = StyleSheet.create({
  group: {
    gap: 8,
    paddingHorizontal: liveVoiceSelectBoxInset,
    paddingBottom: 8,
  },
});
