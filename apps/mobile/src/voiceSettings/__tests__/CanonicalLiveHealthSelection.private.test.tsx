import { fireEvent, render, screen } from '@testing-library/react-native';
import { NativeModules, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppButton } from '../../layout/AppButton';
import { useCanonicalLiveHealthSelection } from '../useCanonicalLiveHealthSelection';
import {
  readCanonicalLiveHealthChoice,
  saveCanonicalLiveHealthSettings,
  revokeCanonicalLiveHealthSettings,
} from '../liveCanonicalHealthSettings';

jest.mock('../liveCanonicalHealthSettings', () => ({
  readCanonicalLiveHealthChoice: jest.fn(),
  saveCanonicalLiveHealthSettings: jest.fn(),
  revokeCanonicalLiveHealthSettings: jest.fn(),
}));

function Harness({ revision = 1, otherDraft = false }) {
  const form = useCanonicalLiveHealthSelection(
    { revision, backend: 'gpt-6-sol' },
    otherDraft,
  );
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 430, height: 800 },
        insets: { top: 0, right: 0, bottom: 24, left: 0 },
      }}
    >
      <View>
        {form.option}
        {form.disclosureSheet}
        <AppButton
          title="fixture save"
          disabled={form.busy}
          onPress={() => {
            form.save();
          }}
        />
      </View>
    </SafeAreaProvider>
  );
}

const stable = () => true;
const read = jest.mocked(readCanonicalLiveHealthChoice);
const save = jest.mocked(saveCanonicalLiveHealthSettings);
const revoke = jest.mocked(revokeCanonicalLiveHealthSettings);
const original = NativeModules.VoiceRealtimeModule;
const os = Platform.OS;
let enabled = false;
let persisted: jest.Mock;

beforeEach(() => {
  Platform.OS = 'ios';
  NativeModules.VoiceRealtimeModule = {
    supportsCanonicalHealthContextV2: true,
  };
  enabled = false;
  persisted = jest.fn();
  read.mockReset().mockImplementation(async () => ({
    enabled,
    current: stable,
    ownerCurrent: stable,
  }));
  revoke.mockReset().mockImplementation(async () => {
    enabled = false;
  });
  save.mockReset().mockImplementation(async input => {
    const approved = await input.confirm(
      {
        providerId: 'openai-live-responses',
        recipient: 'OpenAI Responses (Live)',
        model: 'gpt-6-sol',
        policyVersion: 'canonical-health-context-result-v2',
      },
      input.signal,
    );
    if (!approved || !input.current()) return false;
    enabled = true;
    persisted();
    return true;
  });
});
afterEach(() => {
  NativeModules.VoiceRealtimeModule = original;
  Platform.OS = os;
});

test('a draft alone makes no grant, shared save prompts separately, and cancel writes nothing', async () => {
  await render(<Harness />);
  const choice = await screen.findByRole('switch');
  expect(choice.props.accessibilityState.checked).toBe(false);
  await fireEvent.press(choice);
  expect(save).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'fixture save' }));
  expect(
    await screen.findByText(/기록 조회와 결과 전송을 따로/u),
  ).toBeVisible();
  await fireEvent.press(screen.getByTestId('inference-disclosure-cancel'));
  expect(persisted).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'fixture save' }));
  await fireEvent.press(
    await screen.findByTestId('inference-disclosure-allow'),
  );
  expect(persisted).toHaveBeenCalledTimes(1);
});

test('changing the active account revision drops the pending approval', async () => {
  const mounted = await render(<Harness />);
  await fireEvent.press(await screen.findByRole('switch'));
  await fireEvent.press(screen.getByRole('button', { name: 'fixture save' }));
  await screen.findByTestId('inference-disclosure-allow');
  await mounted.rerender(<Harness revision={2} />);
  expect(screen.queryByTestId('inference-disclosure-allow')).toBeNull();
  expect(persisted).not.toHaveBeenCalled();
});

test('an old native bridge has no chooser, settings lookup, or automatic grant', async () => {
  NativeModules.VoiceRealtimeModule = {};
  await render(<Harness />);
  expect(screen.queryByRole('switch')).toBeNull();
  expect(read).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
