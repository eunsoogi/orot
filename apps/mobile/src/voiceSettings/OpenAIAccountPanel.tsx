import { APIAccountActions } from './APIAccountActions';
import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { providerSettingsStyles } from '../layout/providerSettingsPresentation';
import { appColors } from '../layout/appColors';
import { OpenAIProviderMark } from '../providers/selection/OpenAIProviderMark';
import { apiKeyPanelStyles as styles } from './apiKeyPanelStyles';
import { AppText as Text } from '../layout/AppText';
import { AppButton as Button } from '../layout/AppButton';
import { APIPlatformLink } from './APIPlatformLink';
import { voiceSettingsStore } from './voiceSettingsStore';

/** Manage the one OpenAI API credential independently from ChatGPT subscription
 * accounts. Stored secrets never enter the view, and replacement is atomic.
 * A connected account stays collapsed until explicit editing; cancel only discards the draft.
 */
export function OpenAIAccountPanel() {
  const [editing, setEditing] = useState(false);
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
    if (locked.current || busy || failed || (!remove && !key.trim())) return;
    locked.current = true;
    setBusy(true);
    try {
      await voiceSettingsStore.setAccountKey(remove ? '' : key);
      if (!alive.current) return;
      setConnected(!remove);
      setKey('');
      setEditing(false);
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
        <View style={providerSettingsStyles.header}>
          <View style={providerSettingsStyles.icon}>
            <OpenAIProviderMark />
          </View>
          <View style={providerSettingsStyles.copy}>
            <Text style={providerSettingsStyles.secondary}>
              {connected
                ? t('modelSettings.keyConnected')
                : t('modelSettings.keyDisconnected')}
            </Text>
          </View>
          {connected ? (
            <APIAccountActions
              disabled={busy || failed}
              busy={busy}
              editing={editing}
              onEdit={() => {
                if (!busy && !failed && !locked.current) {
                  setKey('');
                  setEditing(true);
                  setMessage('');
                }
              }}
              onRemove={() => {
                save(true);
              }}
            />
          ) : null}
        </View>
        {!connected || editing ? (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>{t('modelSettings.apiKey')}</Text>
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
                placeholderTextColor={appColors.secondary}
                style={styles.input}
              />
            </View>
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
                title={t('modelSettings.cancel')}
                testID="openai-api-key-cancel"
                disabled={busy || failed}
                onPress={() => {
                  if (!busy && !locked.current) {
                    setKey('');
                    setEditing(false);
                    setMessage('');
                  }
                }}
              />
            ) : null}
          </>
        ) : null}

        {message ? <Text accessibilityRole="alert">{message}</Text> : null}
      </View>
      <View style={styles.guidance}>
        <Text style={providerSettingsStyles.detail}>
          {t('modelSettings.savingPrivacy')}
        </Text>
        <Text style={providerSettingsStyles.detail}>
          {t('modelSettings.apiBilling')}
        </Text>
        <APIPlatformLink />
      </View>
    </View>
  );
}
