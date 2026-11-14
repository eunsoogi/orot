import { AvatarArtwork as AvatarSymbol } from './AvatarArtwork';
import { appearanceEditorStyles as styles } from './appearanceEditorStyles';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Modal,
  Pressable,
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
    symbol: 'face.smiling',
  },
  sun: { label: t('assistantAppearance.sun'), symbol: 'sun.max.fill' },
  leaf: { label: t('assistantAppearance.leaf'), symbol: 'leaf.fill' },
  star: { label: t('assistantAppearance.star'), symbol: 'star.fill' },
};

export { AvatarArtwork as AvatarSymbol } from './AvatarArtwork';

/** Draft selection stays local until one protected transaction succeeds. */
export function AppearanceEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial?: AssistantAppearance;
  onSave: (value: AssistantAppearance) => void;
  onCancel?: () => void;
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
  return (
    <Modal
      visible
      animationType="none"
      onRequestClose={busy ? () => {} : (onCancel ?? (() => {}))}
    >
      <SafeAreaLayout
        scrollable
        scrollTestID="assistant-appearance-scroll"
        scrollContentStyle={styles.content}
      >
        <AppText accessibilityRole="header" style={styles.title}>
          {t(
            initial
              ? 'assistantAppearance.title'
              : 'assistantAppearance.welcome',
          )}
        </AppText>
        <AppText>{t('assistantAppearance.introduction')}</AppText>
        <View style={styles.preview}>
          <View style={styles.previewDisc}>
            {avatar ? (
              <AvatarSymbol avatar={avatar} size={156} />
            ) : (
              <AppSymbol
                name="person.crop.circle.dashed"
                size={72}
                color={appColors.secondary}
              />
            )}
          </View>
          <AppText style={styles.previewName}>
            {name.trim() || defaultAssistantName}
          </AppText>
        </View>
        <View style={styles.choices}>
          {avatarIds.map(id => (
            <Pressable
              key={id}
              accessibilityRole="radio"
              accessibilityLabel={avatars[id].label}
              accessibilityState={{ checked: avatar === id }}
              onPress={() => setAvatar(id)}
              style={styles.choice}
            >
              <View
                style={[styles.choiceDisc, avatar === id && styles.selected]}
              >
                <AvatarSymbol avatar={id} size={60} />
              </View>
              <AppText>
                {avatars[id].label}
                {avatar === id ? ` ${t('assistantAppearance.selected')}` : ''}
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
          testID="assistant-appearance-save"
          title={t(
            initial ? 'assistantAppearance.save' : 'assistantAppearance.start',
          )}
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
      </SafeAreaLayout>
    </Modal>
  );
}
