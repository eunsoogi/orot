import { t } from '../i18n';
import { liveModel } from './liveVoicePreferences';
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
    id: liveModel,
    mode: 'openai-api',
    title: 'GPT-Live-1.1',
    detail: 'OpenAI Live API에서 음성 대화를 처리해요.',
  },
] as const;
export const localVoiceModel = voiceModels[0].id;
export function validVoiceModel(mode: string, model: string): boolean {
  // Live is a distinct stored selection. Do not expose it in the old Realtime catalog.
  return (
    (mode === 'openai-api' &&
      ['gpt-realtime-2.1', 'gpt-realtime-2.1-mini'].includes(model)) ||
    voiceModels.some(item => item.mode === mode && item.id === model)
  );
}
