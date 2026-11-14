import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppButton as Button } from '../layout/AppButton';
import { voiceSettingsStore } from './voiceSettingsStore';

/** Manage the one OpenAI API credential independently from ChatGPT subscription
 * accounts. Stored secrets never enter the view, and replacement is atomic.
 */
export function OpenAIAccountPanel() {
  const [key, setKey] = useState('');
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  const alive = useRef(false);
  const locked = useRef(false);
  useEffect(() => {
    alive.current = true;
    voiceSettingsStore
      .accountStatus()
      .then(status => {
        if (alive.current) setConnected(status.connected);
      })
      .catch(() => {
        if (alive.current) {
          setFailed(true);
          setMessage('API 계정을 읽지 못했습니다. 화면을 다시 열어 주세요.');
        }
      })
      .finally(() => {
        if (alive.current) setBusy(false);
      });
    return () => {
      alive.current = false;
    };
  }, []);
  const save = async (remove = false) => {
    if (locked.current || failed || (!remove && !key.trim())) return;
    locked.current = true;
    setBusy(true);
    try {
      await voiceSettingsStore.setAccountKey(remove ? '' : key);
      if (!alive.current) return;
      setConnected(!remove);
      setKey('');
      setMessage(
        remove
          ? 'API 연결을 해제했습니다. 저장된 음성 모델 선택은 유지됩니다. 로컬 모델로 자동 전환하지 않습니다.'
          : 'API 키를 저장했습니다. 음성 모델 설정에서 목록을 새로고침해 주세요.',
      );
    } catch {
      if (alive.current)
        setMessage('API 키를 저장하지 못했습니다. 기존 연결은 유지됩니다.');
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <View testID="openai-api-account" style={styles.panel}>
      <Text accessibilityRole="header">OpenAI API 계정</Text>
      <Text>{connected ? 'API 키 연결됨' : 'API 키 연결 안 됨'}</Text>
      <Text>
        ChatGPT 구독 및 로그인과 별개의 연결입니다. API 통화에는 별도 요금이
        발생할 수 있습니다.
      </Text>
      <Text>
        기존 음성 설정의 키를 그대로 사용합니다. 키는 이 기기가 잠금 해제된
        동안에만 접근할 수 있는 Keychain에 보관하며 표시하지 않습니다.
      </Text>
      <TextInput
        accessibilityLabel="OpenAI API 키"
        testID="openai-api-key"
        value={key}
        onChangeText={setKey}
        editable={!busy && !failed}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        textContentType="none"
        maxLength={4096}
        placeholder={connected ? '변경할 API 키 입력' : 'API 키 입력'}
        style={styles.input}
      />
      <Button
        title="API 키 저장"
        testID="openai-api-key-save"
        disabled={busy || failed || !key.trim()}
        onPress={() => {
          save();
        }}
      />
      {connected ? (
        <Button
          title="OpenAI API 연결 해제"
          testID="openai-api-key-remove"
          disabled={busy || failed}
          onPress={() => {
            save(true);
          }}
        />
      ) : null}
      <Text>저장만으로 API 요청이나 음성 전송은 시작되지 않습니다.</Text>
      {message ? <Text accessibilityRole="alert">{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 12 },
  input: { minHeight: 44, padding: 12 },
});
