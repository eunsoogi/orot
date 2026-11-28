import {
  authorizeModelCall,
  DEFAULT_MULTI_AGENT_BUDGET,
  type ExecutionConsentPort,
  type OutboundProcessingRequest,
} from '@orot/agent-runtime';
import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { APPLE_FOUNDATION_MODEL_SELECTION_ID } from '../../providers/selection/options';
import { createConversationDurableIdentity } from '../../ragConversation/conversationDurableIdentity';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { RagConversationOutcome } from '../../ragConversation/outcome';
import { t } from '../../i18n';
import { operationRunId } from './featureRunIdentity';
import { conversationReceiptSelection } from './conversationReceiptSelection';
import type { AiFeatureLocalData } from './localData';
import type { requireSelectedAi } from './provider';
import { classifyHealthSummaryMemory } from './classifyHealthSummaryMemory';
import { offerHealthSummarySections } from './offerHealthSummarySections';

/** A request explicitly asks for an excerpt. The current, local model may select one
 * opaque offered slot, but cannot supply medical prose, a source ID, or a different action. */
export async function rememberHealthSummarySection(input: {
  readonly observer?: RagConversationObserver;
  readonly question: string;
  readonly protectedRequest: boolean;
  readonly signal: AbortSignal;
  readonly loadData: () => Promise<AiFeatureLocalData>;
  readonly select: () => Promise<ReturnType<typeof requireSelectedAi>>;
  readonly consent: ExecutionConsentPort;
}): Promise<RagConversationOutcome | 'ordinary' | 'whole-summary' | undefined> {
  const { observer, signal, loadData, select, consent } = input;
  let dispatched = false;
  const denied = (): RagConversationOutcome => ({
    status: 'failure',
    kind: signal.aborted
      ? 'cancelled'
      : dispatched
        ? 'health_summary_section_unverified'
        : 'protected_memory_not_saved',
    discardUnverifiedDraft: true,
  });
  const fallback = () =>
    input.protectedRequest ? denied() : ('ordinary' as const);
  const target = observer?.reportBookmark;
  const scope = target?.section;
  const retention = observer?.retentionSession;
  const expected = observer?.expectedConversationModel;
  if (
    observer?.inputOrigin !== 'composer' ||
    observer.photoInput ||
    observer.selectedRecordingTranscript ||
    observer.expectedVoiceSelection ||
    !observer.retentionRequestId ||
    !target ||
    !scope ||
    retention?.id !== target.lease.id ||
    retention.version !== target.lease.version ||
    expected?.providerId !== APPLE_PROVIDER_ID ||
    expected.modelId !== APPLE_FOUNDATION_MODEL_SELECTION_ID
  )
    return undefined;
  if (!scope.current() || signal.aborted) return fallback();
  const controller = new AbortController();
  const stop = () => controller.abort();
  const nativeSignal = scope.signal;
  if (nativeSignal.aborted) return fallback();
  signal.addEventListener('abort', stop, { once: true });
  nativeSignal.addEventListener('abort', stop, { once: true });
  let unwatch: (() => void) | undefined;
  let retireConsent: (() => void) | undefined;
  let ownsSectionIntent = false;
  try {
    const selected = await select();
    const witness = selected.onDeviceSelectionWitness;
    if (
      selected.provider.id !== APPLE_PROVIDER_ID ||
      selected.selection.providerId !== APPLE_PROVIDER_ID ||
      selected.selection.modelId !== expected.modelId ||
      selected.modelId !== expected.modelId ||
      selected.option.privacyBoundary !== 'on-device' ||
      !selected.provider.capabilities.toolCalling ||
      selected.remoteProcessing ||
      witness?.isCurrent() !== true
    )
      return fallback();
    const current = () =>
      !signal.aborted &&
      !controller.signal.aborted &&
      witness.isCurrent() &&
      scope.current() &&
      expected.isCurrent?.() !== false;
    unwatch = witness.subscribe(stop);
    const source = {
      artifactId: target.artifactId,
      lease: target.lease,
      revision: scope.revision,
      current,
      confirmProtected: scope.confirmProtected,
    };
    if (
      !current() ||
      (expected.isDurablyCurrent && !(await expected.isDurablyCurrent())) ||
      !current()
    )
      return denied();
    const intent = await classifyHealthSummaryMemory({
      question: input.question,
      selected,
      current,
      confirm: source.confirmProtected,
      signal: controller.signal,
      consent,
    });
    if (!current()) return { status: 'failure', kind: 'cancelled' };
    if (!intent) return fallback();
    if (intent !== 'section') return intent;
    ownsSectionIntent = true;
    const storage = await (
      await loadData()
    ).openConversationArtifactStorage?.();
    if (!storage || !current()) return denied();
    const candidates = await storage.readExactHealthSummarySections(source);
    if (!current() || !candidates.length) return denied();

    const offer = offerHealthSummarySections(input.question, candidates);
    const { payload } = offer;
    const request = {
      operationRunId: operationRunId(),
      providerId: selected.provider.id,
      modelId: selected.modelId,
      recipient: selected.recipient,
      remoteProcessing: false,
      consentScope: {
        purpose: 'record_conversation',
        dataCategories: ['conversation', 'generated_artifacts'],
        policyVersion: 'local-artifacts-v1',
      },
      allowedScope: { sourceKinds: ['generated_artifact'] },
      payload,
      signal: controller.signal,
    } satisfies OutboundProcessingRequest;
    // The canonical byte budget rejects an oversized *entire* offer rather
    // than quietly hiding a later section or substituting a shorter one.
    const identity = {
      operationRunId: request.operationRunId,
      providerId: request.providerId,
      modelId: request.modelId,
      recipient: request.recipient,
      remoteProcessing: false,
      consentScope: request.consentScope,
      allowedScope: request.allowedScope,
      budget: DEFAULT_MULTI_AGENT_BUDGET,
    };
    const grant = await authorizeModelCall(
      payload,
      identity,
      consent,
      controller.signal,
    );
    if (grant.status !== 'authorized') return denied();
    const admitted = () =>
      current() &&
      grant.isCurrent() &&
      consent.isAuthorizationCurrent?.(request) !== false;
    retireConsent = consent.subscribeAuthorizationInvalidation?.(request, stop);
    if (
      !current() ||
      (await consent.authorize(request)) !== 'authorized' ||
      !admitted() ||
      !(await source.confirmProtected()) ||
      !admitted() ||
      !grant.consume(payload, identity, controller.signal)
    )
      return denied();
    const { provider } = conversationReceiptSelection(selected, {
      ...observer,
      expectedConversationModel: { ...expected, isCurrent: admitted },
    });
    dispatched = true;
    const result = await provider.generate(payload, {
      signal: controller.signal,
    });
    if (
      !admitted() ||
      !result.ok ||
      result.value.finishReason !== 'tool_calls' ||
      result.value.toolCalls.length !== 1
    )
      return denied();
    const section = candidates[offer.selectedOrdinal(result.value)];
    if (!section) return denied();
    const authorizedSource = { ...source, current: admitted };
    const saved = await storage.bookmarkHealthSummarySection(
      authorizedSource,
      section.ordinal,
      createConversationDurableIdentity(),
    );
    if (!saved || !admitted()) return denied();
    const proof = await storage.readBookmarkedHealthSummarySection(
      saved,
      authorizedSource,
    );
    if (
      !proof ||
      proof.ordinal !== section.ordinal ||
      proof.title !== section.title ||
      proof.summary !== section.summary ||
      proof.uncertainty !== section.uncertainty ||
      JSON.stringify(proof.missingData) !==
        JSON.stringify(section.missingData) ||
      !admitted()
    )
      return denied();
    return {
      status: 'answer',
      answer: t('savedMemory.generatedReportHealthSummarySectionSaved'),
      committedAnswerMemory: true,
      citations: [],
    };
  } catch {
    return ownsSectionIntent ? denied() : fallback();
  } finally {
    controller.abort();
    signal.removeEventListener('abort', stop);
    nativeSignal.removeEventListener('abort', stop);
    unwatch?.();
    retireConsent?.();
  }
}
