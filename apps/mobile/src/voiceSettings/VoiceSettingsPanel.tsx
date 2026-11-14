import { localVoiceModel, voiceModels } from './voiceModels';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppButton as Button } from '../layout/AppButton';
import { appColors } from '../layout/appColors';
import { voiceSettingsStore, type VoiceMode } from './voiceSettingsStore';

/** This configuration surface is not an audio transport or permission/consent dialog. */
export function VoiceSettingsPanel() {
  const [mode, setMode] = useState<VoiceMode>('local');
  const [model, setModel] = useState<string>(localVoiceModel);
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
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
        setHasKey(value.hasApiKey);
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
  const save = async (removeKey = false) => {
    if (locked.current || failedLoad) return;
    locked.current = true;
    setBusy(true);
    setMessage('');
    try {
      // Removing a credential explicitly restores local mode; no implicit fallback at call time.
      await voiceSettingsStore.save({
        mode: removeKey ? 'local' : mode,
        model: removeKey ? localVoiceModel : model,
        replacementKey: key,
        removeKey,
      });
      if (!mounted.current) return;
      setHasKey(removeKey ? false : Boolean(key.trim()) || hasKey);
      if (removeKey) {
        setMode('local');
        setModel(localVoiceModel);
      }
      setKey('');
      setMessage(
        '음성 설정을 저장했습니다. API 통화 연결은 아직 지원하지 않습니다.',
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
      <Text accessibilityRole="header" style={styles.title}>
        음성 모델 선택
      </Text>
      <Text>
        대화 AI처럼 음성 모델을 선택하세요. Apple 시스템 음성은 인식·합성만
        처리하며, 답변은 위에서 선택한 대화 AI가 만듭니다.
      </Text>
      {voiceModels.map(item => (
        <Pressable
          key={item.id}
          accessibilityRole="radio"
          accessibilityState={{
            selected: model === item.id,
            disabled: busy || failedLoad,
          }}
          disabled={busy || failedLoad}
          onPress={() => {
            setMode(item.mode);
            setModel(item.id);
            setMessage('');
          }}
          testID={`voice-model-${item.id}`}
          style={[styles.option, model === item.id && styles.selected]}
        >
          <Text>{item.title}</Text>
          <Text>{item.detail}</Text>
        </Pressable>
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
            현재는 설정 저장만 지원합니다. API를 선택하면 음성 통화를 시작할 수
            없으며, 기기 내 처리로 자동 전환하지 않습니다. 키 확인이나 음성
            전송은 하지 않습니다.
          </Text>
          <TextInput
            accessibilityLabel="음성 API 키"
            testID="voice-api-key"
            value={key}
            onChangeText={setKey}
            editable={!busy && !failedLoad}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            textContentType="none"
            autoComplete="off"
            placeholder={
              hasKey ? '저장된 키 유지 (변경할 때만 입력)' : 'API 키 입력'
            }
            style={styles.input}
            maxLength={4096}
          />
          <Text>
            키는 이 기기의 잠금 해제 시에만 접근 가능한 Keychain에 저장합니다.
            저장된 키는 표시하지 않습니다.
          </Text>
        </>
      )}
      <Button
        title="음성 설정 저장"
        testID="voice-settings-save"
        disabled={busy || failedLoad}
        onPress={() => {
          void save();
        }}
      />
      {hasKey && (
        <Button
          title="음성 API 키 삭제 및 기기 내 처리 선택"
          testID="voice-key-remove"
          disabled={busy || failedLoad}
          onPress={() => {
            void save(true);
          }}
        />
      )}
      {message ? <Text accessibilityRole="alert">{message}</Text> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: {
    padding: 16,
    gap: 12,
    borderRadius: 16,
    backgroundColor: appColors.surface,
  },
  title: { fontSize: 18, fontWeight: '600', color: appColors.text },
  option: {
    minHeight: 44,
    justifyContent: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: 12,
  },
  selected: { borderColor: appColors.primary, borderWidth: 2 },
  input: {
    minHeight: 44,
    padding: 12,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: 12,
    color: appColors.text,
  },
});
