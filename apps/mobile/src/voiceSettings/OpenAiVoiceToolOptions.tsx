import { Pressable, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { providerSettingsStyles as styles } from '../layout/providerSettingsPresentation';
import type { LiveResponsesBackend } from './liveResponsesSettingsIdentity';

export function OpenAiVoiceToolOptions({
  models,
  selected,
  disabled,
  choose,
}: {
  models: readonly LiveResponsesBackend[];
  selected: LiveResponsesBackend | undefined;
  disabled: boolean;
  choose: (model: LiveResponsesBackend) => void;
}) {
  return models.map(model => (
    <Pressable
      key={model}
      accessibilityRole="radio"
      accessibilityState={{ selected: selected === model, disabled }}
      disabled={disabled}
      style={styles.option}
      testID={`voice-tool-model-${model}`}
      onPress={() => choose(model)}
    >
      <View style={styles.icon}>
        <AppSymbol
          name="wrench.and.screwdriver"
          color={appColors.primaryText}
        />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{model}</Text>
      </View>
      <AppSymbol
        name={selected === model ? 'checkmark.circle.fill' : 'circle'}
        color={appColors.text}
      />
    </Pressable>
  ));
}
