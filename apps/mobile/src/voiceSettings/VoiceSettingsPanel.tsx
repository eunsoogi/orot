import { View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppButton as Button } from '../layout/AppButton';
import { providerSettingsStyles as styles } from '../layout/providerSettingsPresentation';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';
import { useVoiceCatalog } from './useVoiceCatalog';
import { useVoiceSelection } from './useVoiceSelection';
import { hasRealtimeVoiceRuntime } from './voiceRuntimeCapability';
import { voiceModels } from './voiceModels';
import { VoiceModelOption } from './VoiceModelOption';
import { VoiceCatalogAccount } from './VoiceCatalogAccount';

/** Local and API providers are sibling sections; a hidden tab must not own navigation actions. */
export function VoiceSettingsPanel({
  onOpenAccounts,
  active = true,
}: {
  readonly onOpenAccounts?: () => void;
  readonly active?: boolean;
}) {
  const catalog = useVoiceCatalog();
  const selection = useVoiceSelection(catalog);
  const realtimeAvailable = hasRealtimeVoiceRuntime();
  const { mode, model, savedModel, busy, failedLoad, message } = selection;
  const disabled =
    busy ||
    failedLoad ||
    (mode === 'openai-api' && (!catalog.fresh || !catalog.ids.includes(model)));
  const hasDock = useNavigationRouteActions(
    [
      {
        id: 'confirm-voice-model',
        label: '이 보이스 사용',
        accessibilityLabel: '이 보이스 사용',
        testID: 'voice-settings-save',
        systemImageName: 'checkmark',
        disabled,
        busy,
        onPress: selection.save,
      },
    ],
    active,
  );
  const choices = (connection: 'local' | 'openai-api') =>
    voiceModels
      .filter(
        item =>
          item.mode === connection &&
          (item.mode === 'local' || catalog.ids.includes(item.id)),
      )
      .map(item => (
        <VoiceModelOption
          key={item.id}
          item={item}
          selected={model === item.id}
          disabled={
            busy || failedLoad || (item.mode === 'openai-api' && !catalog.fresh)
          }
          onPress={() => selection.choose(item.mode, item.id)}
        />
      ));
  return (
    <View testID="voice-settings-panel">
      <View style={styles.section} testID="voice-model-group-local">
        <Text accessibilityRole="header" style={styles.heading}>
          Apple
        </Text>
        {choices('local')}
        <Text style={styles.detail}>
          기기 내 처리: 음성 인식과 읽어주기는 기기에서 실행합니다. 인식된
          텍스트는 선택한 대화 AI에 기존 동의 절차로 전달될 수 있습니다.
        </Text>
      </View>
      <View style={styles.section} testID="voice-model-group-openai-api">
        <Text accessibilityRole="header" style={styles.heading}>
          OpenAI API
        </Text>
        <View style={styles.account}>
          <VoiceCatalogAccount
            catalog={catalog}
            onOpenAccounts={onOpenAccounts}
          />
          {choices('openai-api')}
        </View>
        <Text accessibilityRole="status" style={styles.secondary}>
          {catalog.message}
        </Text>
        {!catalog.fresh && catalog.ids.length > 0 ? (
          <Text style={styles.detail}>
            이 API 계정의 이전 조회 목록입니다. 최신 목록이 아니므로 새로고침 후
            선택해 주세요.
          </Text>
        ) : null}
        <Text style={styles.detail}>
          목록 조회는 음성이나 대화 내용을 보내지 않으며 통화를 시작하지
          않습니다.
        </Text>
        {mode === 'openai-api' && !catalog.ids.includes(model) ? (
          <Text accessibilityRole="alert">
            저장된 모델 {model}의 현재 사용 가능 여부를 확인하지 못했습니다.
            선택은 유지되며 다른 모델로 자동 전환하지 않습니다.
          </Text>
        ) : null}
      </View>
      <View style={styles.section}>
        {!busy && !failedLoad ? (
          <View style={styles.account}>
            <Text testID="voice-current-model">현재 선택: {savedModel}</Text>
          </View>
        ) : null}
        {mode === 'openai-api' ? (
          <>
            <Text>
              API 처리에는 음성과 대화 내용의 OpenAI 전송 및 API 사용 요금이
              발생할 수 있습니다. ChatGPT 로그인과 API 키는 별개입니다. 이용
              가능한 크레딧은 API 계정에서 확인하세요.
            </Text>
            <Text accessibilityRole="alert">
              {realtimeAvailable
                ? '통화를 시작할 때 마이크 사용과 OpenAI로의 음성 전송에 별도로 동의해야 합니다. 설정 저장만으로 키를 확인하거나 음성을 전송하지 않습니다.'
                : '이 빌드에는 Realtime 통화 기능이 없어 설정만 저장할 수 있습니다. 통화를 시작할 수 없으며, 기기 내 처리로 자동 전환하지 않습니다.'}
            </Text>
          </>
        ) : null}
        {!hasDock && active ? (
          <Button
            title="이 보이스 사용"
            testID="voice-settings-save"
            disabled={disabled}
            onPress={selection.save}
          />
        ) : null}
        {message ? <Text accessibilityRole="alert">{message}</Text> : null}
      </View>
    </View>
  );
}
