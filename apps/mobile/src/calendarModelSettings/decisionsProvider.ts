import { t } from '../i18n';
import { NativeModules } from 'react-native';
import { providerFailure, providerSuccess } from '@orot/model-runtime';
import {
  calendarDecisionsModel,
  classifyCalendarDecisions,
} from '@orot/provider-openai';
import type { ProviderSelectionOption } from '../providers/selection/types';
import { voiceSettingsStore } from '../voiceSettings/voiceSettingsStore';
import { calendarCandidatesFromRequest } from './decisionsRequest';

interface NativeDecisionsTransport {
  post(body: string, apiKey: string, requestId: string): Promise<string>;
  cancel(requestId: string): void;
}
let sequence = 0;

/** No credentials enter settings/UI state. Consent and evidence freshness remain in the workflow. */
export function createCalendarDecisionsOption(
  modelId: string,
  expectedAccountRevision: number,
): ProviderSelectionOption {
  const transport = NativeModules.CalendarDecisionsTransport as
    NativeDecisionsTransport | undefined;
  const available =
    modelId === calendarDecisionsModel &&
    Number.isSafeInteger(expectedAccountRevision) &&
    expectedAccountRevision >= 0 &&
    Boolean(transport?.post && transport?.cancel);
  return {
    modelId,
    displayName: 'GPT-6 Luna · OpenAI API',
    privacyBoundary: 'selected-context-remote',
    availability: available
      ? { status: 'available' }
      : {
          status: 'unavailable',
          message: t('modelSettings.decisionsUnavailable'),
        },
    provider: {
      kind: 'language-model',
      id: 'openai-api-decisions',
      displayName: 'OpenAI API · Calendar Decisions',
      capabilities: {
        inputTypes: ['text'],
        streaming: false,
        structuredOutput: true,
        toolCalling: false,
      },
      async generate(request, options) {
        if (!available || !transport) return failure();
        const controller = new AbortController();
        const requestId = `calendar-decisions-${Date.now()}-${++sequence}`;
        let started = false;
        const cancel = () => {
          controller.abort();
          if (started) transport.cancel(requestId);
        };
        const unsubscribe = voiceSettingsStore.subscribe(() => {
          if (
            !voiceSettingsStore.accountRevisionMatches(expectedAccountRevision)
          )
            cancel();
        });
        options?.signal?.addEventListener('abort', cancel, { once: true });
        try {
          if (options?.signal?.aborted) cancel();
          const candidates = calendarCandidatesFromRequest(request);
          const apiKey = await voiceSettingsStore.classificationCredentials(
            expectedAccountRevision,
            controller.signal,
          );
          const value = await classifyCalendarDecisions(
            candidates,
            async body => {
              if (controller.signal.aborted) throw new Error('Cancelled');
              started = true;
              const response = await transport.post(body, apiKey, requestId);
              if (controller.signal.aborted || response.length > 262144)
                throw new Error('Unavailable');
              return JSON.parse(response) as unknown;
            },
            controller.signal,
          );
          // Pending writes settle before results can be published under a stale account.
          const account = await voiceSettingsStore.accountStatus();
          if (
            controller.signal.aborted ||
            account.revision !== expectedAccountRevision ||
            !account.connected
          )
            return failure();
          return providerSuccess({
            text: '',
            toolCalls: [],
            finishReason: 'complete',
            structuredOutput: {
              type: 'result',
              value,
              citations: candidates.map(candidate => candidate.candidateId),
            },
          });
        } catch {
          return failure();
        } finally {
          unsubscribe();
          options?.signal?.removeEventListener('abort', cancel);
        }
      },
    },
  };
}
function failure() {
  // Native/HTTP/storage errors may contain a credential or private title; never forward their text.
  return providerFailure({
    code: 'provider_unavailable',
    message: 'Calendar Decisions unavailable or account changed',
    retryable: false,
  });
}
