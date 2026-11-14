import { Pressable, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { providerSettingsStyles as styles } from '../layout/providerSettingsPresentation';
import type { voiceModels } from './voiceModels';

/** Voice and language choices share layout, not provider capabilities or selection logic. */
export function VoiceModelOption({
  item,
  selected,
  disabled,
  onPress,
}: {
  readonly item: (typeof voiceModels)[number];
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={`voice-model-${item.id}`}
      style={styles.option}
    >
      <View style={styles.icon}>
        <AppSymbol
          name={item.mode === 'local' ? 'sparkles' : 'waveform'}
          color={appColors.primaryText}
        />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{item.title}</Text>
        {item.mode === 'openai-api' ? (
          <Text style={styles.detail}>{item.id}</Text>
        ) : null}
        <Text style={styles.detail}>{item.detail}</Text>
      </View>
      <AppSymbol
        name={selected ? 'checkmark.circle.fill' : 'circle'}
        color={appColors.text}
      />
    </Pressable>
  );
}
