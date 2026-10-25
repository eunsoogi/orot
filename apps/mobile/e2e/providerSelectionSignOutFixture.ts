import { NativeModules } from 'react-native';
import { createOpenAIPlanProvider } from '../src/providers/openai';
import {
  nativeChatGPTSelectionServices,
  type ChatGPTSelectionServices,
} from '../src/providers/selection/chatGPTServices';
import { providerSelectionStore } from '../src/providers/selection/keychainSelectionStore';

interface SimulatorFixtureModule {
  probeAuthSessionCancellation?: () => Promise<string>;
  prepareSyntheticFixture?: (
    scenario: string,
  ) => Promise<{ issuedClientID?: string; authSessionReturn?: string }>;
  restoreSyntheticAccountForSignIn?: () => Promise<void>;
  removeSyntheticFixture?: () => Promise<void>;
}

let syntheticSignOutAccountID: string | null = null;

// The native fixture confines sign-out and in-flight response traffic to synthetic Keychain state and URL protocols.
export const syntheticSignOutLifecycleServices: ChatGPTSelectionServices = {
  ...nativeChatGPTSelectionServices,
  signIn: async () => {
    const fixture = getSimulatorFixtureModule();
    if (!fixture?.restoreSyntheticAccountForSignIn) {
      throw new Error('Synthetic fixture restore is unavailable.');
    }
    await fixture.restoreSyntheticAccountForSignIn();
    const account = (await nativeChatGPTSelectionServices.listAccounts()).find(
      value => value.issuedClientID === syntheticSignOutAccountID,
    );
    if (!account)
      throw new Error('Synthetic account did not return after sign-in.');
    return account;
  },
};

export async function prepareSyntheticSignOutLifecycle(): Promise<void> {
  const fixture = getSimulatorFixtureModule();
  if (!fixture?.prepareSyntheticFixture)
    throw new Error('Synthetic fixture is unavailable.');
  const prepared = await fixture.prepareSyntheticFixture('cancellable');
  if (!prepared.issuedClientID)
    throw new Error('Synthetic fixture account is unavailable.');
  syntheticSignOutAccountID = prepared.issuedClientID;
  await providerSelectionStore.save({
    providerId: `chatgpt-plan:${prepared.issuedClientID}:gpt-synthetic`,
    modelId: 'gpt-synthetic',
  });
}

export async function removeSyntheticSignOutFixture(): Promise<void> {
  const fixture = getSimulatorFixtureModule();
  if (!fixture?.removeSyntheticFixture)
    throw new Error('Synthetic fixture is unavailable.');
  await fixture.removeSyntheticFixture();
  syntheticSignOutAccountID = null;
}

export async function probeSyntheticAuthSessionReturn(): Promise<string> {
  const prepare = getSimulatorFixtureModule()?.prepareSyntheticFixture;
  if (!prepare) return 'unavailable';
  const result = await prepare('authSessionReturn');
  return result.authSessionReturn ?? 'failed';
}

export async function probeSyntheticAuthSessionCancellation(): Promise<boolean> {
  const probe = getSimulatorFixtureModule()?.probeAuthSessionCancellation;
  if (!probe) return false;
  return (await probe()) === 'verified';
}

// The UI success path reads the synthetic Keychain account only after the native session callback returns.
export async function completeSyntheticAuthReturn() {
  if ((await probeSyntheticAuthSessionReturn()) !== 'verified') {
    throw new Error('Synthetic authentication did not return to the app.');
  }
  const account = (await nativeChatGPTSelectionServices.listAccounts()).find(
    value => !value.requiresSignIn && value.hasDirectPlanAccess,
  );
  if (!account) throw new Error('Synthetic account was not restored.');
  return account;
}

export function startSyntheticSignOutResponse(
  setState: (state: string) => void,
): void {
  // Distinguish an unpressed probe control from a stream that has not yielded a delta yet.
  setState('started');
  const issuedClientID = syntheticSignOutAccountID;
  if (!issuedClientID) {
    setState('failed:fixture_unavailable');
    return;
  }
  const provider = createOpenAIPlanProvider(issuedClientID, {
    slug: 'gpt-synthetic',
    displayName: 'Synthetic model',
  });
  const stream = provider.stream?.({
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Synthetic sign-out race check.' }],
      },
    ],
  });
  if (!stream) {
    setState('failed:stream_unavailable');
    return;
  }

  // Continue consuming after the first fixture delta so sign-out must interrupt an active stream.
  (async () => {
    let receivedDelta = false;
    for await (const result of stream) {
      if (!result.ok) {
        setState(`failed:${result.error.code}`);
        return;
      }
      if (result.value.type === 'text_delta') {
        receivedDelta = true;
        setState('pending-after-delta');
      } else if (result.value.type === 'completed') {
        setState('completed');
      }
    }
    if (receivedDelta) setState('ended-after-delta');
  })().catch(() => setState('failed:unexpected'));
}

function getSimulatorFixtureModule(): SimulatorFixtureModule | undefined {
  return NativeModules.OpenAIProviderModule as
    SimulatorFixtureModule | undefined;
}
