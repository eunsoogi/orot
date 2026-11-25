import type { nativeLiveManagedTools } from './nativeLiveManagedTools';
import { matchesCanonicalLiveHealthOwner } from './bindCanonicalLiveHealthRun';
import { readCanonicalLiveHealthStartup } from '../voiceSettings/liveCanonicalHealthSettings';
import type { LiveResponsesSettings } from '../voiceSettings/liveResponsesSettings';
import { t } from '../i18n';
import type { RealtimeToolConfirmationRequest } from './useRealtimeToolConfirmation';

/** This authorizes offering the existing canonical capability for one call,
 * not reading or transferring any individual record. */
export function createCanonicalLiveSessionApproval() {
  const controller = new AbortController();
  let approvedId: string | undefined;
  return {
    allows: (id: string) => !controller.signal.aborted && approvedId === id,
    retire: () => controller.abort(),
    async confirm(input: {
      id?: string;
      selection: Extract<LiveResponsesSettings, { kind: 'active' }>;
      current: () => boolean;
      protectedAvailable: () => Promise<boolean | null>;
      review: (request: RealtimeToolConfirmationRequest) => Promise<boolean>;
      nativeReview?: NonNullable<
        ReturnType<typeof nativeLiveManagedTools>
      >['reviewCanonicalCall'];
    }) {
      const startup = await readCanonicalLiveHealthStartup(input.selection);
      const owned = () => !controller.signal.aborted && input.current();
      if (!owned() || startup.kind === 'unavailable')
        return { kind: 'stale' } as const;
      if (startup.kind === 'off') {
        return startup.current() ? startup : ({ kind: 'stale' } as const);
      }
      const companion = startup.companion;
      const id = input.id;
      const current = () =>
        owned() &&
        Boolean(id) &&
        matchesCanonicalLiveHealthOwner(companion, input.selection);
      const protectedCurrent = async () =>
        current() && (await input.protectedAvailable()) === true && current();
      if (!id || !(await protectedCurrent())) return { kind: 'stale' } as const;
      const approved = input.nativeReview
        ? await input.nativeReview(
            id,
            companion.binding,
            input.selection.nativeGrant,
            controller.signal,
          )
        : await input.review({
            text: t('realtimeToolConsent.liveSessionBoundary'),
            use: 'live-canonical-session',
            recipient: 'OpenAI Responses (Live)',
            model: companion.binding.backendModel,
            signal: controller.signal,
          });
      if (approved === null || !(await protectedCurrent()))
        return { kind: 'stale' } as const;
      if (!approved) return { kind: 'denied' } as const;
      approvedId = id;
      return {
        kind: 'approved',
        companion,
        current: companion.current,
      } as const;
    },
  };
}
