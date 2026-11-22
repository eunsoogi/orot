import { t } from '../i18n';
import type { VoiceState } from './voiceTurn';

/** Keep status labels tied to observed session phases, not configured model promises. */
export function voiceStatus(
  photoPending: boolean,
  error: boolean,
  preparing: boolean,
  state: VoiceState,
  controls: { readonly manualFinish: boolean } = { manualFinish: true },
): string {
  return photoPending
    ? t('ragConversation.voice.photo')
    : state.phase === 'error' && state.error === 'consent'
      ? t('ragConversation.voice.settingsConsentRequired')
      : error || state.phase === 'error'
        ? t('ragConversation.voice.error')
        : state.phase === 'authorizing' || preparing
          ? t('ragConversation.voice.authorizing')
          : state.phase === 'listening'
            ? t(
                controls.manualFinish
                  ? 'ragConversation.voice.listening'
                  : 'ragConversation.voice.listeningAutomatically',
              )
            : state.phase === 'processing'
              ? t('ragConversation.voice.processing')
              : state.phase === 'speaking'
                ? t('ragConversation.voice.speaking')
                : state.phase === 'cleaning'
                  ? t('ragConversation.voice.cleaning')
                  : '';
}
