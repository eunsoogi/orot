import {
  canReuseConsent,
  consentRevision,
} from '../agent/execution/consentRevision';
import { settingsConsentAuthority } from '../storage/settingsConsentAuthority';
import { voiceSelectionMutation } from './voiceConsentIdentity';
import type { SettingsVoicePairSelection } from '../storage/settingsVoicePairSelection';

/** Storage readiness is not permission. A retained generation marker after
 * cancellation, revocation, or an uncertain write cannot appear active. */
export async function currentVoicePairAuthorities(
  pair: SettingsVoicePairSelection,
) {
  const revision = consentRevision();
  const selected = voiceSelectionMutation.capture();
  if (!selected) return null;
  const audio = settingsConsentAuthority('voice');
  const tools = settingsConsentAuthority('voice-responses');
  const [audioState, toolsState] = await Promise.all([
    audio.current(),
    tools.current(),
  ]);
  if (
    audioState?.generation !== pair.voiceGeneration ||
    toolsState?.generation !== pair.responsesGeneration
  )
    return null;
  const audioCurrent = audio.witness(pair.voiceGeneration);
  const toolsCurrent = tools.witness(pair.responsesGeneration);
  return () =>
    selected() &&
    canReuseConsent() &&
    consentRevision() === revision &&
    audioCurrent() &&
    toolsCurrent();
}
