import type { WarmConversationPreparation } from './conversationWarmAdmission';
import {
  bindWarmDispatchReservation,
  prepareWarmDispatchRoute,
} from './conversationWarmDispatchReservation';
import { isWarmConversationSender } from './warmConversationSender';
import {
  appendPlainHistoryToSender,
  type PlainHistoryPlan,
} from './plainConversationSendContext';
import { markConversationInput } from '../providers/conversationInputDiagnostic';
import { reserveQuickChoice } from './conversationQuickChoicePreview';
import { t } from '../i18n';
import { startOwnedConversationRequest } from './conversationOwnedRequest';
import type { createConversationSessionRequests } from './conversationSessionRequests';
import type { createConversationPhotoImport } from './conversationPhotoImport';
import type {
  ConversationSession,
  ConversationSender,
  ConversationSessionOptions,
} from './conversationSessionTypes';

/** Preflight belongs to the same cancellable request as model dispatch, including voice-owned turns. */
export function conversationDispatch(input: {
  requests: ReturnType<typeof createConversationSessionRequests>;
  photoDrafts: ReturnType<typeof createConversationPhotoImport>;
  retention?: ConversationSessionOptions['retention'];
  options?: Pick<
    ConversationSessionOptions,
    'retention' | 'captureWarmExecution' | 'execution'
  >;
  disposed: () => boolean;
  find: (id: number) => ConversationSession | undefined;
  update: (id: number, change: Partial<ConversationSession>) => void;
  current: (id: number) => boolean;
  selection?: {
    epoch: { selection: number };
    subscribe: (listener: () => void) => () => void;
  };
  bindSender?: (
    sender: ConversationSender,
    warm?: WarmConversationPreparation,
  ) => ConversationSender;
  beforeSend?: (
    id: number,
    signal: AbortSignal,
    allowWarm: boolean,
  ) => Promise<boolean | PlainHistoryPlan | WarmConversationPreparation>;
}) {
  const execution = input.options?.execution;
  const preparing = new Map<number, AbortController>();
  const cancelPreparation = (id: number) => {
    const controller = preparing.get(id);
    if (!controller) return;
    preparing.delete(id);
    controller.abort();
    if (!preparing.has(id))
      input.update(id, {
        preparingSend: false,
        preparingQuickChoice: undefined,
      });
  };
  const send = async (
    id: number,
    sender: ConversationSender,
    prompt?: string,
    registerOwner?: (cancel: () => boolean) => void,
    quickChoice = false,
  ) => {
    const session = input.find(id);
    if (
      input.disposed() ||
      !session ||
      session.busy ||
      session.quarantined ||
      preparing.has(id)
    )
      return;
    // Noncontinuous callers have no protected preflight and keep their synchronous start contract.
    if (!input.beforeSend) {
      await input.requests.send(
        id,
        input.bindSender?.(sender) ?? sender,
        prompt,
        prompt === undefined && input.photoDrafts.get(id).status !== 'empty',
        registerOwner,
      );
      return;
    }
    const controller = new AbortController();
    preparing.set(id, controller);
    const current = () =>
      !input.disposed() &&
      input.current(id) &&
      Boolean(input.find(id)) &&
      preparing.get(id) === controller &&
      !controller.signal.aborted;
    registerOwner?.(() => {
      if (preparing.get(id) !== controller) return false;
      cancelPreparation(id);
      return true;
    });
    // Publish preparation before protected reads, without inventing a model message.
    let release!: () => void;
    const cancelled = new Promise<false>(resolve => {
      release = () => resolve(false);
    });
    controller.signal.addEventListener('abort', release, { once: true });
    let dispatched = false;
    let stopWatchingSelection = () => {};
    const reservationOwner = new AbortController();
    const closeReservation = () => reservationOwner.abort();
    controller.signal.addEventListener('abort', closeReservation, {
      once: true,
    });
    try {
      // The preview is the user's own accepted prompt, with no delivery claim.
      input.update(id, {
        preparingSend: true,
        error: '',
        preparingQuickChoice:
          quickChoice && current()
            ? reserveQuickChoice(prompt, input.requests.reserveUserMessageId)
            : undefined,
      });
      markConversationInput('conversation_send_preparing');
      if (!current()) return;
      const prepare = (allowWarm: boolean) =>
        Promise.race([
          input.beforeSend?.(id, controller.signal, allowWarm) ??
            Promise.resolve(true),
          cancelled,
        ]);
      const hasPhoto = () =>
        prompt === undefined && input.photoDrafts.get(id).status !== 'empty';
      const allowWarm =
        !registerOwner &&
        (prompt === undefined || quickChoice) &&
        input.photoDrafts.get(id).status === 'empty' &&
        isWarmConversationSender(sender);
      const planned = allowWarm
        ? prepareWarmDispatchRoute(
            input,
            id,
            controller,
            reservationOwner.signal,
          )
        : undefined;
      const reservation = planned?.reservation;
      let early = planned?.early;
      if (planned?.stopWatching) stopWatchingSelection = planned.stopWatching;
      let ready = await prepare(allowWarm);
      if (!ready || !current()) return;
      // Only a certified short-lease failure may fall back to the original foreground path.
      if (early && (await early.started) !== 'short-lease-admitted') {
        if (execution?.currentPhase?.() !== 'active' || !current()) return;
        early = undefined;
      }
      let warm =
        typeof ready === 'object' && 'kind' in ready ? ready : undefined;
      // A queued picker can change the scope while text-only local proof waits.
      // Discard that proof and re-enter the original strict model path first.
      if (warm && hasPhoto() && current()) {
        warm = undefined;
        closeReservation();
        ready = await prepare(false);
        if (typeof ready === 'object' && 'kind' in ready) return;
      }
      if (!ready || !current()) return;
      // The same owner transitions synchronously into requests.send before another tap can enter.
      dispatched = true;
      const plan =
        typeof ready === 'object' && !('kind' in ready) ? ready : undefined;
      const prepared = plan
        ? appendPlainHistoryToSender(sender, {
            ...plan,
            current: () =>
              !input.disposed() && input.current(id) && plan.current(),
          })
        : sender;
      const bound = input.bindSender?.(prepared, warm) ?? prepared;
      if (!warm) closeReservation();
      const sending = input.requests.send(
        id,
        warm && reservation
          ? bindWarmDispatchReservation(
              bound,
              reservation,
              closeReservation,
              early,
            )
          : bound,
        prompt,
        hasPhoto(),
        registerOwner,
      );
      if (preparing.get(id) === controller) {
        preparing.delete(id);
        input.update(id, {
          preparingSend: false,
          preparingQuickChoice: undefined,
        });
      }
      await sending;
    } catch (error) {
      if (dispatched) throw error;
      // A rejected draft must not put its retry notice on newer text.
      if (
        current() &&
        (prompt !== undefined || input.find(id)?.draft === session.draft)
      )
        input.update(id, {
          error: t('ragConversation.preflight.failed'),
          errorSurface: 'composerPreflight',
        });
    } finally {
      stopWatchingSelection();
      closeReservation();
      controller.signal.removeEventListener('abort', closeReservation);
      controller.signal.removeEventListener('abort', release);
      if (preparing.get(id) === controller) {
        preparing.delete(id);
        input.update(id, {
          preparingSend: false,
          preparingQuickChoice: undefined,
        });
      }
    }
  };
  return {
    cancelBeforeSend: cancelPreparation,
    disposeBeforeSend() {
      for (const id of preparing.keys()) cancelPreparation(id);
    },
    send: (id: number, sender: ConversationSender) => send(id, sender),
    sendPrompt: (id: number, prompt: string, sender: ConversationSender) =>
      send(id, sender, prompt),
    sendQuickPrompt: (id: number, prompt: string, sender: ConversationSender) =>
      send(id, sender, prompt, undefined, true),
    sendOwnedPrompt: (id: number, prompt: string, sender: ConversationSender) =>
      startOwnedConversationRequest({
        retention: input.disposed()
          ? undefined
          : (input.options?.retention ?? input.retention),
        sender,
        start: (ownedSender, registerOwner) =>
          send(id, ownedSender, prompt, registerOwner),
      }),
  };
}
