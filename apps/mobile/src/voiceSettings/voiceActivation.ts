import { t } from '../i18n';
import { Alert } from 'react-native';
import { requireLocalVoiceProcessing } from './voiceSettingsStore';

/** Configuration alone is never permission to capture or silently choose another model. */
export async function canActivateVoiceModel(): Promise<boolean> {
  if (await requireLocalVoiceProcessing()) return true;
  Alert.alert(t('modelSettings.voiceChanged'), t('modelSettings.voiceRestart'));
  return false;
}
