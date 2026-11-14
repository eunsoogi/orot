/** Static documented catalog, not an account-entitlement or runtime-availability claim.
 * OpenAI IDs: https://developers.openai.com/api/docs/guides/realtime (2026-11-14).
 * Apple owns its Speech/AVSpeechSynthesizer models; no fabricated version is exposed.
 */
export const voiceModels = [
  {
    id: 'apple-system-speech',
    mode: 'local',
    title: 'Apple 시스템 음성',
    detail:
      '기기 내 음성 인식·합성 · 언어/기기 지원 필요 · 답변은 선택한 대화 AI',
  },
  {
    id: 'gpt-realtime-2.1',
    mode: 'openai-api',
    title: 'GPT Realtime 2.1',
    detail: 'OpenAI Realtime API · 음성 입출력 · 네트워크·API 키 필요',
  },
  {
    id: 'gpt-realtime-2.1-mini',
    mode: 'openai-api',
    title: 'GPT Realtime 2.1 mini',
    detail: 'OpenAI Realtime API · 음성 입출력 · 네트워크·API 키 필요',
  },
] as const;
export const localVoiceModel = voiceModels[0].id;
export function validVoiceModel(mode: string, model: string): boolean {
  return voiceModels.some(item => item.mode === mode && item.id === model);
}
