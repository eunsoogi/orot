import type { ComponentProps } from 'react';
import { Button } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { VoiceSettingsPanel } from '../VoiceSettingsPanel';

/** Mount the real shared route action; only its painted button shell is synthetic. */
export function VoiceSettingsDockFixture(
  props: ComponentProps<typeof VoiceSettingsPanel>,
) {
  const { host, actions } = useNavigationPrimaryActionHost('voice-settings');
  return (
    <NavigationPrimaryActionContext.Provider value={host}>
      <VoiceSettingsPanel {...props} />
      {actions.map(action => (
        <Button
          key={action.id}
          testID="voice-settings-shared-dock-save"
          title={action.label}
          disabled={action.disabled}
          onPress={action.onPress}
        />
      ))}
    </NavigationPrimaryActionContext.Provider>
  );
}
