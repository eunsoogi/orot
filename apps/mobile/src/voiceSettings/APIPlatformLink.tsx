import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';

// Only this public URL crosses the OS boundary. No credentials or app content
// are accepted here. HTTPS follows the system browser, not an embedded login.
const platformURL = 'https://platform.openai.com/api-keys';

export function APIPlatformLink() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const open = async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await Linking.openURL(platformURL);
    } catch {
      // Do not surface native error payloads, which may contain private context.
      if (mounted.current) setFailed(true);
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="OpenAI API 키 관리 페이지 열기"
        accessibilityHint="앱 밖에서 공식 OpenAI API 플랫폼을 엽니다"
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        onPress={() => {
          open();
        }}
        style={styles.link}
        testID="openai-api-platform-link"
      >
        <Text style={styles.label}>OpenAI API 키 관리 페이지 열기</Text>
      </Pressable>
      {failed ? (
        <Text accessibilityRole="alert">
          페이지를 열지 못했습니다. 위 링크를 눌러 다시 시도해 주세요.
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: 8 },
  link: { minHeight: 44, justifyContent: 'center', paddingVertical: 10 },
  label: { color: appColors.primaryText, textDecorationLine: 'underline' },
});
