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
import SafeAreaLayout from '../layout/SafeAreaLayout';
import {
  avatarIds,
  defaultAssistantName,
  normalizeAssistantName,
} from './appearance';
import type { AssistantAppearance, AvatarId } from './appearance';
import { appearanceStore } from './appearanceStore';

const avatars: Record<AvatarId, { label: string; symbol: string }> = {
  neutral: { label: '기본', symbol: 'person.crop.circle' },
  sun: { label: '햇살', symbol: 'sun.max' },
  leaf: { label: '잎', symbol: 'leaf' },
  star: { label: '별', symbol: 'star' },
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
          ? '이름은 24글자 이내로 입력해 주세요.'
          : '줄바꿈이나 제어 문자는 사용할 수 없어요.',
      );
      return;
    }
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      onSave(await appearanceStore.save({ avatar, name: normalized }));
    } catch {
      setError('저장하지 못했어요. 다시 시도해 주세요.');
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
      setError('설정을 지우지 못했어요. 다시 시도해 주세요.');
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
              비서 꾸미기
            </AppText>
            <AppText>
              함께할 비서의 모습을 선택해 주세요. 선택은 이 기기에만 저장돼요.
            </AppText>
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
                    {avatar === id ? ' 선택됨' : ''}
                  </AppText>
                </Pressable>
              ))}
            </View>
            <AppText nativeID="assistant-name-label">비서 이름 (선택)</AppText>
            <TextInput
              accessibilityLabel="비서 이름"
              accessibilityLabelledBy="assistant-name-label"
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="어떤 이름으로 부를까요?"
              placeholderTextColor={appColors.secondary}
              returnKeyType="done"
            />
            <AppText>
              이름을 비우면 ‘비서’로 표시해요. 24글자까지 입력할 수 있어요.
            </AppText>
            <AppText>개인정보나 건강 정보는 입력하지 마세요.</AppText>
            {error ? (
              <AppText accessibilityRole="alert" style={styles.error}>
                {error}
              </AppText>
            ) : null}
            <AppButton
              title="저장"
              disabled={!avatar}
              busy={busy}
              onPress={save}
            />
            {onCancel ? (
              <AppButton
                title="취소"
                variant="cancel"
                disabled={busy}
                onPress={onCancel}
              />
            ) : null}
            {onClear ? (
              <AppButton
                title="선택 지우기"
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
