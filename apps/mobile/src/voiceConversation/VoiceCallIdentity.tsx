import { StyleSheet, View } from 'react-native';
import { AvatarSymbol } from '../assistantAppearance/AppearanceEditor';
import { useAssistantAppearance } from '../assistantAppearance/AssistantAppearanceProvider';
import type { AssistantAppearance } from '../assistantAppearance/appearance';
import { defaultAssistantName } from '../assistantAppearance/appearance';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';

/** Call identity comes from saved preferences, never the mockup's sample name. */
export function VoiceCallIdentity() {
  const appearance = useAssistantAppearance();
  if (!appearance?.ready) return null;
  return <SavedVoiceCallIdentity value={appearance.value} />;
}

/** Pure presentation also enables explicitly synthetic, audio-free native UI fixtures. */
export function SavedVoiceCallIdentity({
  value,
}: {
  value: AssistantAppearance;
}) {
  return (
    <View style={styles.identity} testID="voice-call-identity">
      <View style={styles.disc}>
        <View style={styles.avatar}>
          <AvatarSymbol avatar={value.avatar} />
        </View>
      </View>
      <AppText
        accessibilityRole="header"
        maxFontSizeMultiplier={1.5}
        style={styles.name}
      >
        {value.name ?? defaultAssistantName}
      </AppText>
    </View>
  );
}
const styles = StyleSheet.create({
  identity: { alignItems: 'center', gap: 24, maxWidth: '100%' },
  disc: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: appColors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { transform: [{ scale: 2 }] },
  name: {
    flexShrink: 1,
    maxWidth: '100%',
    fontSize: 34,
    fontWeight: '700',
    textAlign: 'center',
    color: appColors.text,
  },
});
