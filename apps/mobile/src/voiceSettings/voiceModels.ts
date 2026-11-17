import { t } from '../i18n';
/** Runtime compatibility allowlist, not a selectable account catalog or entitlement claim.
 * OpenAI IDs: https://developers.openai.com/api/docs/guides/realtime (2026-11-14).
 * Apple owns its Speech/AVSpeechSynthesizer models; no fabricated version is exposed.
 */
export const voiceModels = [
  {
    id: 'apple-system-speech',
    mode: 'local',
    title: t('modelSettings.appleVoice'),
    detail: t('modelSettings.localProcessing'),
  },
  {
    id: 'gpt-realtime-2.1',
    mode: 'openai-api',
    title: 'GPT Realtime 2.1',
    detail: t('modelSettings.realtimeDescription'),
  },
  {
    id: 'gpt-realtime-2.1-mini',
    mode: 'openai-api',
    title: 'GPT Realtime 2.1 mini',
    detail: t('modelSettings.realtimeDescription'),
  },
] as const;
export const localVoiceModel = voiceModels[0].id;
export function validVoiceModel(mode: string, model: string): boolean {
  return voiceModels.some(item => item.mode === mode && item.id === model);
}
