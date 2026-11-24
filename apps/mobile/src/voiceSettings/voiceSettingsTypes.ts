export type VoiceMode = 'local' | 'openai-api';
export interface VoiceSettings {
  readonly mode: VoiceMode;
  readonly model: string;
  readonly hasApiKey: boolean;
  readonly pairAwaitingActivation?: boolean;
}
export interface StoredVoiceSettings {
  mode: VoiceMode;
  model: string;
  apiKey: string;
  credentialEpoch?: string;
  effectiveResponsesGeneration?: string;
  pairCandidates?: readonly import('./voicePairDeviceCandidate').VoicePairDeviceCandidate[];
}
