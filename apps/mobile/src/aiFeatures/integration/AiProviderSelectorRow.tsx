import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { t } from '../../i18n';
import { AppSymbol } from '../../layout/AppSymbol';
import { AppText as Text } from '../../layout/AppText';
import { appColors } from '../../layout/appColors';
import type { SelectedAiResolution } from './provider';

interface AiProviderSelectorRowProps {
  readonly onPress: () => void;
  readonly resolveSelectedAi: () => Promise<SelectedAiResolution>;
  readonly revision: number;
}

/** Reads the saved choice for display and leaves unavailable choices explicit, with no provider fallback. */
export function AiProviderSelectorRow({
  onPress,
  resolveSelectedAi,
  revision,
}: AiProviderSelectorRowProps) {
  const [status, setStatus] = useState<
    'loading' | 'selection-required' | 'unavailable' | 'ready'
  >('loading');
  const [selectedName, setSelectedName] = useState('');

  useEffect(() => {
    let current = true;
    setStatus('loading');
    // Show only the exact saved model; lookup failure never picks another provider.
    void resolveSelectedAi().then(
      result => {
        if (!current) return;
        setStatus(result.status);
        if (result.status === 'ready')
          setSelectedName(result.option.displayName);
      },
      () => {
        if (current) setStatus('unavailable');
      },
    );
    return () => {
      current = false;
    };
  }, [resolveSelectedAi, revision]);

  const value =
    status === 'ready'
      ? selectedName
      : status === 'selection-required'
        ? t('provider.selection.rowPrompt')
        : status === 'loading'
          ? t('provider.selection.rowLoading')
          : t('provider.selection.rowUnavailable');
  const rowLabel = `${t('provider.selection.rowTitle')}, ${value}`;

  return (
    <Pressable
      accessibilityLabel={rowLabel}
      accessibilityHint={t('provider.selection.rowHint')}
      accessibilityRole="button"
      accessibilityState={{ busy: status === 'loading' }}
      onPress={onPress}
      style={styles.row}
      testID="ai-feature-select-provider"
    >
      <AppSymbol name="sparkles" size={20} color={appColors.primaryText} />
      <View style={styles.copy}>
        <Text style={styles.title}>{t('provider.selection.rowTitle')}</Text>
        <Text style={styles.value}>{value}</Text>
      </View>
      <AppSymbol name="chevron.right" size={16} color={appColors.secondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  copy: { flex: 1, gap: 2 },
  title: { color: appColors.secondary, fontSize: 13 },
  value: { color: appColors.text, fontSize: 16, fontWeight: '600' },
});
