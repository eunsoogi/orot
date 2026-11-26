import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Button, Text, View } from 'react-native';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { t } from '../../i18n';
import { liveVoiceModelId } from '../../agent/execution/liveVoiceSettingsIdentity';
import { useOpenAiVoicePairSave } from '../useOpenAiVoicePairSave';
import { liveConversationToolsAuthorization } from '../liveConversationToolsAuthorization';
import { loadLiveResponsesSettings } from '../liveResponsesSettings';
import {
  liveResponsesPermissionVersion,
  liveResponsesProviderId,
  liveResponsesRecipient,
} from '../liveResponsesSettingsIdentity';
import { initialPreferences } from '../liveVoicePreferences';
import { voiceSettingsStore } from '../voiceSettingsStore';
import type { OpenAiVoicePair } from '../reviewOpenAiVoicePair';
import { createLiveConversationToolsSettingsFixture } from '../testSupport/liveConversationToolsSettingsFixture';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../storage/settingsConsentAuthority', () => ({
  settingsConsentAuthority: jest.fn(),
}));
jest.mock('../../storage/settingsConsentRepository', () => ({
  settingsConsentRepository: jest.fn(),
}));
jest.mock('../../agent/execution/settingsConsentCredential', () => ({
  settingsConsentCredential: jest.fn(),
}));
jest.mock('../voiceSettingsStore', () => ({
  voiceSettingsStore: {
    accountRevisionMatches: jest.fn(),
    liveCredentials: jest.fn(),
    loadCommittedVoicePair: jest.fn(),
    stageVoicePair: jest.fn(),
    activateVoicePair: jest.fn(),
    captureVoicePairPublication: jest.fn(),
  },
}));
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device' },
  getGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));

const pair: OpenAiVoicePair = {
  speechModel: liveVoiceModelId,
  backendModel: 'gpt-6-sol',
  accountRevision: 1,
};
function Route({
  onSaved,
  commonTools,
}: {
  onSaved: () => void;
  commonTools?: true;
}) {
  const save = useOpenAiVoicePairSave({
    active: true,
    pair,
    commonTools,
    preferences: initialPreferences,
    onSaved,
    onUnavailable: () => {
      throw new Error('Pair publication missing');
    },
  });
  return (
    <View>
      <Button
        title="Save fixture"
        onPress={() => {
          save.save();
        }}
      />
      {save.error ? <Text>{save.error}</Text> : null}
      {save.disclosureSheet}
    </View>
  );
}

const request = (): OutboundProcessingRequest => ({
  operationRunId: 'synthetic-current-call',
  providerId: liveResponsesProviderId,
  modelId: pair.backendModel,
  recipient: liveResponsesRecipient,
  remoteProcessing: true,
  consentScope: {
    purpose: 'record_conversation',
    policyVersion: 'local-artifacts-v1',
    dataCategories: ['conversation', 'generated_artifacts'],
  },
  allowedScope: { sourceKinds: ['generated_artifact'] },
  payload: { messages: [{ role: 'user', content: 'synthetic result' }] },
  signal: new AbortController().signal,
});

test('unified Settings review is one decision with one actual protected pair publication', async () => {
  const f = createLiveConversationToolsSettingsFixture();
  const saved = jest.fn();
  try {
    await render(<Route onSaved={saved} commonTools />);
    const press = async () => {
      await fireEvent.press(screen.getByText('Save fixture'));
    };
    await press();
    expect(
      await screen.findByTestId('inference-disclosure-recipient'),
    ).toHaveTextContent(/OpenAI Responses/);
    expect(
      screen.getByTestId('inference-disclosure-scope-card'),
    ).toHaveTextContent(/OpenAI Live/);
    expect(
      screen.getByTestId('inference-disclosure-scope-card'),
    ).toHaveTextContent(/검토한 기억/);
    await fireEvent.press(screen.getByTestId('inference-disclosure-cancel'));
    await waitFor(() =>
      expect(screen.queryByTestId('inference-disclosure-allow')).toBeNull(),
    );
    expect(await f.store.read('voice')).toBeNull();
    expect(await f.store.read('voice-responses')).toBeNull();
    expect(saved).not.toHaveBeenCalled();
    await press();
    await fireEvent.press(
      await screen.findByTestId('inference-disclosure-allow'),
    );
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('inference-disclosure-allow')).toBeNull();
    const active = await loadLiveResponsesSettings();
    expect(active).toMatchObject({
      kind: 'active',
      commonToolsPolicy: 'common-tools-v3',
    });
    expect(await f.store.read('conversation')).toBeNull();
    expect(voiceSettingsStore.activateVoicePair).toHaveBeenCalledTimes(1);
    if (active.kind !== 'active')
      throw new Error('expected real persisted selection');
    const gate = liveConversationToolsAuthorization(active, () => true);
    const exact = request();
    await expect(gate.authorize(exact)).resolves.toBe('authorized');
    expect(gate.isAuthorizationCurrent(exact)).toBe(true);
    expect(gate.isAuthorizationCurrent({ ...exact })).toBe(false);
    await expect(
      gate.authorize({ ...exact, recipient: 'OpenAI API' }),
    ).resolves.toBe('renewal_required');
    await expect(
      gate.authorize({ ...exact, modelId: 'gpt-6-luna' }),
    ).resolves.toBe('renewal_required');
    await expect(
      gate.authorize({
        ...exact,
        consentScope: { ...exact.consentScope!, dataCategories: ['photo_ocr'] },
      }),
    ).resolves.toBe('renewal_required');
    await expect(
      gate.authorize({
        ...exact,
        consentScope: { ...exact.consentScope!, purpose: 'public_web_search' },
      }),
    ).resolves.toBe('renewal_required');
    const service =
      'com.orot.mobile.live-conversation-tools-policy.v3.' +
      active.nativeGrant.generation;
    const marker = f.keychain.get(service)!;
    expect(JSON.parse(marker.password)).toMatchObject({
      scope: 'selected-live-conversation-local-tools-v3',
      grantID: active.nativeGrant.grantID,
    });
    f.keychain.delete(service);
    await expect(gate.authorize(exact)).resolves.toBe('renewal_required');
    f.keychain.set(service, marker);
    await expect(gate.authorize(exact)).resolves.toBe('authorized');
    await f.responses.revoke();
    expect(gate.isAuthorizationCurrent(exact)).toBe(false);
    await expect(gate.authorize(exact)).resolves.toBe('renewal_required');
  } finally {
    f.db.close();
  }
});

test('legacy pair choice remains audio/heart only and does not retroactively cover common tools', async () => {
  const f = createLiveConversationToolsSettingsFixture();
  const saved = jest.fn();
  try {
    await render(<Route onSaved={saved} />);
    await fireEvent.press(screen.getByText('Save fixture'));
    expect(
      await screen.findByTestId('inference-disclosure-recipient'),
    ).toHaveTextContent(/OpenAI Live/);
    await fireEvent.press(screen.getByTestId('inference-disclosure-allow'));
    await waitFor(() =>
      expect(
        screen.getByTestId('inference-disclosure-recipient'),
      ).toHaveTextContent(/OpenAI Responses/),
    );
    await fireEvent.press(screen.getByTestId('inference-disclosure-allow'));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    const active = await loadLiveResponsesSettings();
    const grant = await f.store.read('voice-responses');
    expect(grant && liveResponsesPermissionVersion(grant.permissions)).toBe(
      'headless-v2',
    );
    if (active.kind !== 'active') throw new Error('expected legacy selection');
    await expect(
      liveConversationToolsAuthorization(active, () => true).authorize(
        request(),
      ),
    ).resolves.toBe('renewal_required');
  } finally {
    f.db.close();
  }
});

test('failed pair staging retires only its newly minted common marker', async () => {
  const f = createLiveConversationToolsSettingsFixture();
  const saved = jest.fn();
  jest
    .mocked(voiceSettingsStore.stageVoicePair)
    .mockRejectedValueOnce(new Error('synthetic stage failure'));
  try {
    await render(<Route onSaved={saved} commonTools />);
    await fireEvent.press(screen.getByText('Save fixture'));
    await fireEvent.press(
      await screen.findByTestId('inference-disclosure-allow'),
    );
    expect(
      await screen.findByText(t('modelSettings.voiceSaveFailed')),
    ).toBeVisible();
    expect(saved).not.toHaveBeenCalled();
    expect(await f.store.read('voice')).toBeNull();
    expect(await f.store.read('voice-responses')).toBeNull();
    expect(
      [...f.keychain.keys()].filter(key =>
        key.includes('live-conversation-tools-policy'),
      ),
    ).toEqual([]);
  } finally {
    f.db.close();
  }
});
