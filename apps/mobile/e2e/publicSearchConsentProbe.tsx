import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { providerSuccess } from '@orot/model-runtime';
import { useInferenceConsent } from '../src/agent/execution/useInferenceConsent';
import { createPublicWebEvidence } from '../src/aiFeatures/integration/publicWebEvidence';
import { runDefaultPublicSearch } from '../src/aiFeatures/integration/defaultPublicSearch';
import type { ProviderSelectionOption } from '../src/providers/selection/types';

/** Drives the real search and disclosure boundary with a synthetic network response. */
export function PublicSearchConsentProbe({
  option,
}: {
  option: ProviderSelectionOption;
}) {
  const { consent, disclosureSheet } = useInferenceConsent();
  const [status, setStatus] = useState('idle');
  const provider = {
    ...option.provider,
    searchPublicWeb: async () =>
      providerSuccess({
        text: 'Synthetic public explanation.',
        callCount: 1,
        citations: [
          { title: 'Synthetic source', url: 'https://example.org/source' },
        ],
      }),
  };
  const web = createPublicWebEvidence({
    selected: {
      status: 'ready',
      selection: { providerId: provider.id, modelId: option.modelId },
      option,
      provider,
      modelId: option.modelId,
      recipient: 'Synthetic public search',
      remoteProcessing: true,
    },
    consent,
  });
  function start() {
    runDefaultPublicSearch({
      tool: web?.tool,
      operationRunId: 'native-public-search-consent',
      request: 'blood pressure',
      signal: new AbortController().signal,
    }).then(result => setStatus(result.status));
  }
  return (
    <View style={styles.container}>
      <Button
        testID="public-search-probe-start"
        title="Search"
        onPress={start}
      />
      <Text testID="public-search-probe-status">{status}</Text>
      {disclosureSheet}
    </View>
  );
}

// Keep the synthetic action within the visible content area, away from system chrome.
const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center' },
});
