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
import {
  completeSyntheticAuthReturn,
  prepareSyntheticSignOutLifecycle,
  probeSyntheticAuthSessionCancellation,
  removeSyntheticSignOutFixture,
  startSyntheticSignOutResponse,
  syntheticSignOutLifecycleServices,
} from './providerSelectionSignOutFixture';

// Keep confirmation below a long model catalog so the native probe must scroll to it.
const syntheticModelCatalog = [
  { slug: 'gpt-synthetic', displayName: 'Synthetic ChatGPT model' },
  ...Array.from({ length: 11 }, (_, index) => ({
    slug: `gpt-synthetic-${index + 2}`,
    displayName: `Synthetic ChatGPT model ${index + 2}`,
  })),
];
const options = [
  createAppleSelectionOption('available'),
  ...createChatGPTSelectionOptions('synthetic-account', syntheticModelCatalog),
];
const initialSummary =
  'selectionCallback=not-called-on-load; synthetic=enabled; realAccount=unverified';

export function ProviderSelectionProbe() {
  const [authFlow, setAuthFlow] = useState<
    'cancel' | 'success' | 'signOutLifecycle' | null
  >(null);
  const [summary, setSummary] = useState(initialSummary);
  const [signOutResponseState, setSignOutResponseState] = useState('idle');

  if (authFlow) {
    const services =
      authFlow === 'success'
        ? syntheticSuccessfulChatGPTServices
        : authFlow === 'signOutLifecycle'
          ? syntheticSignOutLifecycleServices
          : syntheticChatGPTServices;
    return (
      <View style={styles.container}>
        {authFlow === 'signOutLifecycle' ? (
          // Keep simulator controls visible while the provider setup screen scrolls below.
          <View style={styles.probeControls}>
            <Button
              onPress={() =>
                startSyntheticSignOutResponse(setSignOutResponseState)
              }
              testID="provider-selection-sign-out-request"
              title="합성 추론 진행 검사"
            />
            <Text testID="provider-selection-sign-out-response">
              {signOutResponseState}
            </Text>
          </View>
        ) : null}
        <View style={styles.flow}>
          <ProviderSelectionFlow
            chatGPTServices={services}
            onBack={() => setAuthFlow(null)}
            selectionStore={providerSelectionStore}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text testID="provider-selection-probe-summary">{summary}</Text>
      <Button
        onPress={() =>
          probeSyntheticAuthSessionCancellation()
            .then(verified =>
              setSummary(
                `nativeAuthSessionCancellation=${verified ? 'verified' : 'failed'}; realAccount=unverified`,
              ),
            )
            .catch(() =>
              setSummary(
                'nativeAuthSessionCancellation=failed; realAccount=unverified',
              ),
            )
        }
        testID="provider-selection-native-auth-cancel"
        title="네이티브 인증 창 취소 검사"
      />
      <Button
        onPress={() => setAuthFlow('cancel')}
        testID="provider-selection-auth-cancel"
        title="합성 ChatGPT 로그인 취소 검사"
      />
      <Button
        onPress={() => {
          syntheticSignInCompleted = false;
          syntheticReturnedAccount = null;
          setAuthFlow('success');
        }}
        testID="provider-selection-auth-success"
        title="합성 ChatGPT 로그인 복귀 검사"
      />
      <Button
        onPress={() =>
          prepareSyntheticSignOutLifecycle()
            .then(() => {
              setSignOutResponseState('idle');
              setAuthFlow('signOutLifecycle');
            })
            .catch(() =>
              setSummary(
                'syntheticSignOutFixture=failed; realAccount=unverified',
              ),
            )
        }
        testID="provider-selection-sign-out-start"
        title="합성 ChatGPT 로그아웃 흐름 시작"
      />
      <Button
        onPress={() =>
          prepareSyntheticSignOutLifecycle()
            .then(() => {
              setSignOutResponseState('idle');
              setAuthFlow('signOutLifecycle');
            })
            .catch(() =>
              setSummary(
                'syntheticSignOutFixture=failed; realAccount=unverified',
              ),
            )
        }
        testID="provider-selection-sign-out-reopen"
        title="합성 ChatGPT 로그아웃 흐름 다시 열기"
      />
      <Button
        onPress={() =>
          Promise.all([
            providerSelectionStore.clear(),
            removeSyntheticSignOutFixture(),
          ]).then(() => {
            syntheticSignInCompleted = false;
            syntheticReturnedAccount = null;
            setSignOutResponseState('idle');
            setSummary(
              'selectionCallback=not-called-on-load; synthetic=cleared; realAccount=unverified',
            );
          })
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
  signOut: async () => 'localCredentialsCleared',
  cancelSignIn: () => {
    rejectPendingSignIn?.(
      Object.assign(new Error('Synthetic ChatGPT login cancelled.'), {
        code: 'CHATGPT_AUTH_CANCELLED',
      }),
    );
    rejectPendingSignIn = null;
  },
};

// This fixture refreshes real native account summaries only after the system session returns.
let syntheticSignInCompleted = false;
let syntheticReturnedAccount: OpenAIAccountSummary | null = null;

const syntheticSuccessfulChatGPTServices: ChatGPTSelectionServices = {
  listAccounts: async () =>
    syntheticSignInCompleted && syntheticReturnedAccount
      ? [syntheticReturnedAccount]
      : [],
  listModels: async () => providerSuccess([]),
  signIn: async () => {
    const account = await completeSyntheticAuthReturn();
    syntheticReturnedAccount = account;
    syntheticSignInCompleted = true;
    return account;
  },
  signOut: async () => 'localCredentialsCleared',
  cancelSignIn: () => undefined,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f8fa' },
  probeControls: { paddingHorizontal: 16, paddingTop: 8 },
  flow: { flex: 1 },
});
