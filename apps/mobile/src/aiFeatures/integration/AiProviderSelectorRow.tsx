import { useEffect, useState } from 'react';
import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { StyleSheet, View } from 'react-native';
import { t } from '../../i18n';
import { SelectedModelControl } from '../../layout/SelectedModelControl';
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
    void resolveSelectedAi().then(
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
    <View style={!embedded && styles.inset}>
      <SelectedModelControl
        name={value}
        local={status === 'ready' && selectedProviderId === APPLE_PROVIDER_ID}
        label={rowLabel}
        hint={t('provider.selection.rowHint')}
        busy={status === 'loading'}
        onPress={onPress}
        testID="ai-feature-select-provider"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  inset: { marginHorizontal: 20, marginVertical: 8 },
});
