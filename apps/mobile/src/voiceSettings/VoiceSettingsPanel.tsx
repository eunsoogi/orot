import { voiceSettingsStyles as styles } from './voiceSettingsPresentation';
import { useVoiceCatalog } from './useVoiceCatalog';
import { hasRealtimeVoiceRuntime } from './voiceRuntimeCapability';
import { localVoiceModel, voiceModels } from './voiceModels';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppButton as Button } from '../layout/AppButton';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { voiceSettingsStore, type VoiceMode } from './voiceSettingsStore';

/** This configuration surface is not an audio transport or permission/consent dialog. */
export function VoiceSettingsPanel({
  onOpenAccounts,
}: {
  readonly onOpenAccounts?: () => void;
}) {
  const catalog = useVoiceCatalog();
  const realtimeAvailable = hasRealtimeVoiceRuntime();
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<VoiceMode>('local');
  const [model, setModel] = useState<string>(localVoiceModel);
  const [savedModel, setSavedModel] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [failedLoad, setFailedLoad] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(false);
  const locked = useRef(false);
  useEffect(() => {
    mounted.current = true;
    voiceSettingsStore
      .load()
      .then(value => {
        if (!mounted.current) return;
        setMode(value.mode);
        setModel(value.model);
        setSavedModel(value.model);
      })
      .catch(() => {
        if (mounted.current) {
          setFailedLoad(true);
          setMessage('음성 설정을 읽지 못했습니다. 화면을 다시 열어 주세요.');
        }
      })
      .finally(() => {
        if (mounted.current) setBusy(false);
      });
    return () => {
      mounted.current = false;
    };
  }, []);
  const save = async () => {
    if (locked.current || failedLoad) return;
    locked.current = true;
    setBusy(true);
    setMessage('');
    try {
      await voiceSettingsStore.save({
        mode,
        model,
        ...(mode === 'openai-api' && catalog.revision !== null
          ? { expectedAccountRevision: catalog.revision }
          : {}),
      });
      if (!mounted.current) return;
      setSavedModel(model);
      setMessage(
        '음성 설정을 저장했습니다. 통화는 대화 화면에서 별도로 시작해 주세요.',
      );
    } catch {
      if (mounted.current)
        setMessage(
          '저장하지 못했습니다. API 모드에는 모델과 API 키가 필요합니다.',
        );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <View style={styles.panel} testID="voice-settings-panel">
      <View style={styles.header}>
        <Pressable
          style={styles.copy}
          accessibilityRole="button"
          accessibilityLabel="OpenAI API 계정 정보"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(value => !value)}
          testID="voice-account-details"
        >
          <Text accessibilityRole="header" style={styles.title}>
            OpenAI API
          </Text>
          <Text>
            {catalog.connected ? 'API 계정 연결됨' : 'API 계정 연결 필요'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="음성 모델 새로고침"
          accessibilityState={{
            busy: catalog.busy,
            disabled: catalog.busy || !catalog.connected,
          }}
          style={styles.refresh}
          testID="voice-model-refresh"
          disabled={catalog.busy || !catalog.connected}
          onPress={() => {
            catalog.refresh();
          }}
        >
          <AppSymbol
            name="arrow.triangle.2.circlepath"
            color={appColors.primary}
          />
        </Pressable>
      </View>
      {expanded ? (
        <Button
          title="OpenAI API 연결 관리"
          variant="text"
          onPress={onOpenAccounts}
          disabled={!onOpenAccounts}
          testID="voice-open-accounts"
        />
      ) : null}
      {!busy && !failedLoad ? (
        <Text testID="voice-current-model">현재 선택: {savedModel}</Text>
      ) : null}
      <Text accessibilityRole="status">{catalog.message}</Text>
      {!catalog.fresh && catalog.ids.length > 0 ? (
        <Text>
          이 API 계정의 이전 조회 목록입니다. 최신 목록이 아니므로 새로고침 후
          선택해 주세요.
        </Text>
      ) : null}
      <Text>
        목록 조회는 음성이나 대화 내용을 보내지 않으며 통화를 시작하지 않습니다.
      </Text>
      {mode === 'openai-api' && !catalog.ids.includes(model) ? (
        <Text accessibilityRole="alert">
          저장된 모델 {model}의 현재 사용 가능 여부를 확인하지 못했습니다.
          선택은 유지되며 다른 모델로 자동 전환하지 않습니다.
        </Text>
      ) : null}
      {/* Keep local processing visually separate without changing saved selection. */}
      {(['local', 'openai-api'] as const).map(connection => (
        <View
          key={connection}
          style={styles.modelGroup}
          testID={`voice-model-group-${connection}`}
        >
          <Text accessibilityRole="header">
            {connection === 'local'
              ? 'Apple 기기 내 음성 처리'
              : 'OpenAI API 음성 모델'}
          </Text>
          {voiceModels
            .filter(
              item =>
                item.mode === connection &&
                (item.mode === 'local' || catalog.ids.includes(item.id)),
            )
            .map(item => (
              <Pressable
                key={item.id}
                accessibilityRole="radio"
                accessibilityState={{
                  selected: model === item.id,
                  disabled:
                    busy ||
                    failedLoad ||
                    (item.mode === 'openai-api' && !catalog.fresh),
                }}
                disabled={
                  busy ||
                  failedLoad ||
                  (item.mode === 'openai-api' && !catalog.fresh)
                }
                onPress={() => {
                  setMode(item.mode);
                  setModel(item.id);
                  setMessage('');
                }}
                testID={`voice-model-${item.id}`}
                style={styles.option}
              >
                <View style={styles.header}>
                  <Text style={styles.copy}>{item.title}</Text>
                  <AppSymbol
                    name={
                      model === item.id ? 'checkmark.circle.fill' : 'circle'
                    }
                    color={appColors.text}
                  />
                </View>
                {item.mode === 'openai-api' ? <Text>{item.id}</Text> : null}
                <Text>{item.detail}</Text>
              </Pressable>
            ))}
        </View>
      ))}
      <Text>
        기기 내 처리: 음성 인식과 읽어주기는 기기에서 실행합니다. 인식된
        텍스트는 선택한 대화 AI에 기존 동의 절차로 전달될 수 있습니다.
      </Text>
      {mode === 'openai-api' && (
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
      )}
      <Button
        title="음성 설정 저장"
        testID="voice-settings-save"
        disabled={
          busy ||
          failedLoad ||
          (mode === 'openai-api' &&
            (!catalog.fresh || !catalog.ids.includes(model)))
        }
        onPress={() => {
          save();
        }}
      />
      {message ? <Text accessibilityRole="alert">{message}</Text> : null}
    </View>
  );
}
