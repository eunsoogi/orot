import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { providerSettingsStyles } from '../layout/providerSettingsPresentation';
import { appColors } from '../layout/appColors';
import { AppText as Text } from '../layout/AppText';
import { AppButton as Button } from '../layout/AppButton';
import { APIPlatformLink } from './APIPlatformLink';
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
          setMessage(t('modelSettings.apiReadFailed'));
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
          ? t('modelSettings.apiDisconnected')
          : t('modelSettings.apiSaved'),
      );
    } catch {
      if (alive.current) setMessage(t('modelSettings.apiSaveFailed'));
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <View testID="openai-api-account" style={styles.section}>
      <Text accessibilityRole="header" style={providerSettingsStyles.heading}>
        OpenAI API
      </Text>
      <View style={styles.panel}>
        <Text>
          {connected
            ? t('modelSettings.keyConnected')
            : t('modelSettings.keyDisconnected')}
        </Text>
        <Text>{t('modelSettings.apiBilling')}</Text>
        <APIPlatformLink />
        <TextInput
          accessibilityLabel={t('modelSettings.apiKey')}
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
          placeholder={
            connected
              ? t('modelSettings.replaceKey')
              : t('modelSettings.enterKey')
          }
          style={styles.input}
        />
        <Button
          title={t('modelSettings.saveKey')}
          busy={busy}
          testID="openai-api-key-save"
          disabled={busy || failed || !key.trim()}
          onPress={() => {
            save();
          }}
        />
        {connected ? (
          <Button
            title={t('modelSettings.disconnectApi')}
            variant="destructive"
            testID="openai-api-key-remove"
            disabled={busy || failed}
            onPress={() => {
              save(true);
            }}
          />
        ) : null}
        <Text>{t('modelSettings.savingPrivacy')}</Text>
        {message ? <Text accessibilityRole="alert">{message}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  panel: {
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.surface,
  },
  input: {
    minHeight: 44,
    padding: 12,
    color: appColors.text,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: 12,
  },
});
