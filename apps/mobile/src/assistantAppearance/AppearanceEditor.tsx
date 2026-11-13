import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  AccessibilityInfo,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import SafeAreaLayout from '../layout/SafeAreaLayout';
import {
  avatarIds,
  defaultAssistantName,
  normalizeAssistantName,
} from './appearance';
import type { AssistantAppearance, AvatarId } from './appearance';
import { appearanceStore } from './appearanceStore';

const avatars: Record<AvatarId, { label: string; symbol: string }> = {
  neutral: {
    label: t('assistantAppearance.neutral'),
    symbol: 'person.crop.circle',
  },
  sun: { label: t('assistantAppearance.sun'), symbol: 'sun.max' },
  leaf: { label: t('assistantAppearance.leaf'), symbol: 'leaf' },
  star: { label: t('assistantAppearance.star'), symbol: 'star' },
};

export function AvatarSymbol({ avatar }: { avatar: AvatarId }) {
  return (
    <AppSymbol
      name={avatars[avatar].symbol}
      size={32}
      color={appColors.primaryText}
    />
  );
}

/** Draft selection stays local until one protected transaction succeeds. */
export function AppearanceEditor({
  initial,
  onSave,
  onCancel,
  onClear,
  onClearStart,
  onClearFailed,
}: {
  initial?: AssistantAppearance;
  onSave: (value: AssistantAppearance) => void;
  onCancel?: () => void;
  onClear?: () => void;
  onClearStart?: () => void;
  onClearFailed?: () => void;
}) {
  const [avatar, setAvatar] = useState<AvatarId | null>(
    initial?.avatar ?? null,
  );
  const [name, setName] = useState(initial?.name ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  useEffect(() => {
    if (error) AccessibilityInfo.announceForAccessibility(error);
  }, [error]);
  async function save() {
    if (!avatar || saving.current) return;
    let normalized: string | null;
    try {
      normalized = normalizeAssistantName(name);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message === 'length'
          ? t('assistantAppearance.invalidLength')
          : t('assistantAppearance.invalidCharacters'),
      );
      return;
    }
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      onSave(await appearanceStore.save({ avatar, name: normalized }));
    } catch {
      setError(t('assistantAppearance.saveError'));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function clear() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    onClearStart?.();
    try {
      await appearanceStore.clear();
      onClear?.();
    } catch {
      onClearFailed?.();
      setError(t('assistantAppearance.clearError'));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      visible
      animationType="none"
      onRequestClose={busy ? () => {} : (onCancel ?? (() => {}))}
    >
      <SafeAreaLayout>
        <KeyboardAvoidingView
          style={styles.screen}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <AppText accessibilityRole="header" style={styles.title}>
              {t('assistantAppearance.title')}
            </AppText>
            <AppText>{t('assistantAppearance.introduction')}</AppText>
            <View style={styles.preview}>
              {avatar ? <AvatarSymbol avatar={avatar} /> : null}
              <AppText>{name.trim() || defaultAssistantName}</AppText>
            </View>
            <View style={styles.choices}>
              {avatarIds.map(id => (
                <Pressable
                  key={id}
                  accessibilityRole="radio"
                  accessibilityLabel={avatars[id].label}
                  accessibilityState={{ checked: avatar === id }}
                  onPress={() => setAvatar(id)}
                  style={[styles.choice, avatar === id && styles.selected]}
                >
                  <AvatarSymbol avatar={id} />
                  <AppText>
                    {avatars[id].label}
                    {avatar === id
                      ? ` ${t('assistantAppearance.selected')}`
                      : ''}
                  </AppText>
                </Pressable>
              ))}
            </View>
            <AppText nativeID="assistant-name-label">
              {t('assistantAppearance.nameOptional')}
            </AppText>
            <TextInput
              accessibilityLabel={t('assistantAppearance.nameLabel')}
              accessibilityLabelledBy="assistant-name-label"
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={t('assistantAppearance.namePlaceholder')}
              placeholderTextColor={appColors.secondary}
              returnKeyType="done"
            />
            <AppText>{t('assistantAppearance.nameHelp')}</AppText>
            <AppText>{t('assistantAppearance.privacy')}</AppText>
            {error ? (
              <AppText accessibilityRole="alert" style={styles.error}>
                {error}
              </AppText>
            ) : null}
            <AppButton
              title={t('assistantAppearance.save')}
              disabled={!avatar}
              busy={busy}
              onPress={save}
            />
            {onCancel ? (
              <AppButton
                title={t('assistantAppearance.cancel')}
                variant="cancel"
                disabled={busy}
                onPress={onCancel}
              />
            ) : null}
            {onClear ? (
              <AppButton
                title={t('assistantAppearance.clear')}
                variant="text"
                disabled={busy}
                onPress={clear}
              />
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaLayout>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: appColors.background },
  content: { flexGrow: 1, padding: 24, gap: 16 },
  title: { fontSize: 25, fontWeight: '700' },
  preview: { alignItems: 'center', gap: 8, padding: 20 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    minWidth: 72,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 8,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: 16,
  },
  selected: { borderWidth: 2, borderColor: appColors.primaryText },
  input: {
    minHeight: 48,
    padding: 12,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: 12,
    color: appColors.text,
    backgroundColor: appColors.surface,
  },
  error: { color: appColors.danger },
});
