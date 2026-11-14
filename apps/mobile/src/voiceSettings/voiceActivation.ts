import { Alert } from 'react-native';
import { requireLocalVoiceProcessing } from './voiceSettingsStore';

/** Configuration alone is never permission to capture or silently choose another model. */
export async function canActivateVoiceModel(): Promise<boolean> {
  if (await requireLocalVoiceProcessing()) return true;
  Alert.alert(
    '음성 모델이 변경되었습니다',
    '선택한 음성 모델로 다시 시작해 주세요. API Realtime 모델을 기기 내 음성으로 대신 실행하지 않습니다.',
  );
  return false;
}
