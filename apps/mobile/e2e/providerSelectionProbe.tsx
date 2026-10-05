import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { providerSuccess } from '@orot/model-runtime';
import type { OpenAIAccountSummary } from '../src/providers/openai';
import ProviderSelectionFlow from '../src/providers/selection/ProviderSelectionFlow';
import ProviderSelectionScreen from '../src/providers/selection/ProviderSelectionScreen';
import type { ChatGPTSelectionServices } from '../src/providers/selection/chatGPTServices';
import {
  createAppleSelectionOption,
  createChatGPTSelectionOptions,
  visitRecommendationRequirements,
} from '../src/providers/selection/options';
import { providerSelectionStore } from '../src/providers/selection/keychainSelectionStore';

const options = [
  createAppleSelectionOption('available'),
  ...createChatGPTSelectionOptions('synthetic-account', [
    { slug: 'gpt-synthetic', displayName: 'Synthetic ChatGPT model' },
  ]),
];

export function ProviderSelectionProbe() {
  const [showAuthFlow, setShowAuthFlow] = useState(false);
  const [summary, setSummary] = useState(
    'selectionCallback=not-called-on-load; synthetic=enabled; realAccount=unverified',
  );

  if (showAuthFlow) {
    return (
      <ProviderSelectionFlow
        chatGPTServices={syntheticChatGPTServices}
        onBack={() => setShowAuthFlow(false)}
        selectionStore={providerSelectionStore}
      />
    );
  }

  return (
    <View style={styles.container}>
      <Text testID="provider-selection-probe-summary">{summary}</Text>
      <Button
        onPress={() => setShowAuthFlow(true)}
        testID="provider-selection-auth-cancel"
        title="합성 ChatGPT 로그인 취소 검사"
      />
      <Button
        onPress={() =>
          providerSelectionStore
            .clear()
            .then(() =>
              setSummary(
                'selectionCallback=not-called-on-load; synthetic=cleared; realAccount=unverified',
              ),
            )
        }
        testID="provider-selection-probe-reset"
        title="Reset synthetic selection"
      />
      <ProviderSelectionScreen
        options={options}
        requirements={visitRecommendationRequirements}
        selectionStore={providerSelectionStore}
        onSelectionCommitted={() =>
          setSummary(
            'selectionCallback=called; synthetic=provider-selection; realAccount=unverified',
          )
        }
      />
    </View>
  );
}

let rejectPendingSignIn: ((reason: unknown) => void) | null = null;

const syntheticChatGPTServices: ChatGPTSelectionServices = {
  listAccounts: async () => [],
  listModels: async () => providerSuccess([]),
  signIn: () =>
    new Promise<OpenAIAccountSummary>((_resolve, reject) => {
      rejectPendingSignIn = reject;
    }),
  cancelSignIn: () => {
    rejectPendingSignIn?.(
      Object.assign(new Error('Synthetic ChatGPT login cancelled.'), {
        code: 'CHATGPT_AUTH_CANCELLED',
      }),
    );
    rejectPendingSignIn = null;
  },
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f8fa' },
});
