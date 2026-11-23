import { render } from '@testing-library/react-native';
import { VoiceModelOption } from '../../voiceSettings/VoiceModelOption';
import { voiceModels } from '../../voiceSettings/voiceModels';
import { t } from '../../i18n';
import { liveModel } from '../../voiceSettings/liveVoicePreferences';
import { voiceConversationCapability } from '../voiceConversationCapability';

test('local speech retains only normal conversation tools with their existing approvals', () => {
  expect(
    voiceConversationCapability({
      mode: 'local',
      model: 'apple-system-speech',
    }),
  ).toEqual({
    mode: 'selected-conversation',
    tools: {
      records: 'owned-workflow',
      reviewedMemory: 'owned-workflow',
      publicResearch: 'owned-workflow',
      confirmedActions: 'owned-workflow',
      stagedPhotos: 'unsupported',
      protectedResultRelay: 'unsupported',
    },
  });
});

test.each([
  [liveModel, 'live-audio-only'],
  ['gpt-realtime-2.1', 'unsupported-model'],
  ['gpt-realtime-2.1-mini', 'unsupported-model'],
  ['unknown-voice-model', 'unsupported-model'],
] as const)(
  'remote model %s does not inherit private tools or legacy relay',
  (model, mode) => {
    const capability = voiceConversationCapability({
      mode: 'openai-api',
      model,
    });
    expect(capability.mode).toBe(mode);
    expect(Object.values(capability.tools)).toEqual(
      Array(6).fill('unsupported'),
    );
  },
);

test('shows the unsupported tool notice in the Live model option only', async () => {
  const modelNotice = t('modelSettings.liveVoiceToolsUnavailable');
  const local = await render(
    <VoiceModelOption
      item={voiceModels[0]}
      selected
      disabled={false}
      onPress={jest.fn()}
    />,
  );
  expect(local.queryByText(modelNotice)).toBeNull();
  await local.unmount();
  const live = await render(
    <VoiceModelOption
      item={voiceModels[1]}
      selected={false}
      disabled={false}
      onPress={jest.fn()}
    />,
  );
  expect(live.getByText(modelNotice)).toBeVisible();
  expect(live.getByRole('radio')).toBeEnabled();
});
