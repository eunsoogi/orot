// Identity of the opt-in voice transport, not an authorization or a connection test.
export const liveVoiceProviderId = 'openai-live';
export const liveVoiceModelId = 'gpt-live-1.1';
export const liveVoiceRecipient = 'OpenAI Live API';
export const liveVoiceAudioPurpose = 'live_audio';
export const liveVoiceAudioPolicy = 'selected-live-audio-v1';
export const liveVoiceResultPurpose = 'live_result';

/** Only the Live microphone scope has no local evidence sources. */
export function isLiveVoiceAudioScope(purpose: unknown, policy: unknown) {
  return purpose === liveVoiceAudioPurpose && policy === liveVoiceAudioPolicy;
}

/** Never resolve classic Realtime and Live requests to the same persisted owner. */
export function voiceSettingsIdentity(model: string, purpose: string) {
  if (model === liveVoiceModelId) {
    // Result relay has no finalized input/source authority yet. Do not issue it.
    return purpose === liveVoiceAudioPurpose
      ? {
          providerId: liveVoiceProviderId,
          modelId: model,
          recipient: liveVoiceRecipient,
        }
      : null;
  }
  return purpose === 'realtime_audio' || purpose === 'realtime_result'
    ? {
        providerId: 'openai-realtime',
        modelId: model,
        recipient: 'OpenAI Realtime API',
      }
    : null;
}
