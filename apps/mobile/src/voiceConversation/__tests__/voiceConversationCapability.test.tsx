import { render } from '@testing-library/react-native';
import { VoiceModelOption } from '../../voiceSettings/VoiceModelOption';
import { voiceModels } from '../../voiceSettings/voiceModels';
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

test('the Live model row keeps its model ID without repeating capability or processing copy', async () => {
  const live = await render(
    <VoiceModelOption
      item={voiceModels[1]}
      selected={false}
      disabled={false}
      onPress={jest.fn()}
    />,
  );
  expect(live.getByText(liveModel)).toBeVisible();
  expect(live.queryByText(/API에서 음성 대화/)).toBeNull();
  expect(live.queryByText(/기본 음성 모드/)).toBeNull();
  expect(live.getByRole('radio')).toBeEnabled();
});
