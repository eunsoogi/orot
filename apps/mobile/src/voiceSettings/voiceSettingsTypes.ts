export type VoiceMode = 'local' | 'openai-api';
export interface VoiceSettings {
  readonly mode: VoiceMode;
  readonly model: string;
  readonly hasApiKey: boolean;
}
export interface StoredVoiceSettings {
  mode: VoiceMode;
  model: string;
  apiKey: string;
  credentialEpoch?: string;
}
