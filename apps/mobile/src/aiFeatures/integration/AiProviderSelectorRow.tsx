import { useEffect, useState } from 'react';
import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
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
  readonly embedded?: boolean;
}

/** Reads the saved choice for display and leaves unavailable choices explicit, with no provider fallback. */
export function AiProviderSelectorRow({
  onPress,
  resolveSelectedAi,
  revision,
  embedded = false,
}: AiProviderSelectorRowProps) {
  const [status, setStatus] = useState<
    'loading' | 'selection-required' | 'unavailable' | 'ready'
  >('loading');
  const [selectedName, setSelectedName] = useState('');
  const [selectedProviderId, setSelectedProviderId] = useState('');

  useEffect(() => {
    let current = true;
    setStatus('loading');
    // Show only the exact saved model; lookup failure never picks another provider.
    resolveSelectedAi().then(
      result => {
        if (!current) return;
        setStatus(result.status);
        if (result.status === 'ready') {
          setSelectedName(result.option.displayName);
          setSelectedProviderId(result.selection.providerId);
        }
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
      style={[styles.row, embedded && styles.embedded]}
      testID="ai-feature-select-provider"
    >
      {/* Branding follows the resolved saved provider, never a loading or unavailable guess. */}
      <View style={styles.icon}>
        <AppSymbol
          name={
            status === 'ready' && selectedProviderId === APPLE_PROVIDER_ID
              ? 'apple.logo'
              : 'sparkles'
          }
          size={28}
          color={appColors.text}
        />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{t('provider.selection.rowTitle')}</Text>
        <Text style={styles.value}>{value}</Text>
      </View>
      <AppSymbol name="chevron.right" size={16} color={appColors.secondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Composed headers already own their page inset; standalone routes need the row's default inset.
  embedded: { marginHorizontal: 0, marginVertical: 0 },
  row: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 80,
    marginHorizontal: 20,
    marginVertical: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: appColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 2 },
  title: { color: appColors.secondary, fontSize: 13 },
  value: { color: appColors.text, fontSize: 16, fontWeight: '600' },
});
