import { Alert } from 'react-native';
import { requireLocalVoiceProcessing } from './voiceSettingsStore';

/** Configuration alone is never permission to capture or silently choose another model. */
export async function canActivateVoiceModel(): Promise<boolean> {
  if (await requireLocalVoiceProcessing()) return true;
  Alert.alert(
    'Realtime 음성 연결 미지원',
    '선택한 API Realtime 모델은 현재 설정 저장만 지원합니다. Apple 시스템 음성을 직접 선택하면 기존 음성 기능을 사용할 수 있습니다.',
  );
  return false;
}
