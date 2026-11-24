import { renderHook } from '@testing-library/react-native';
import { useInferenceConsent } from '../../../agent/execution/useInferenceConsent';
import {
  conversationPreviewObserver,
  createConversationRequestPreview,
} from '../../../ragConversation/conversationRequestPreview';
import { modelCheckpointScope } from '../conversationModelCheckpointScope';
import { conversationRunInvocation } from '../conversationRunOptions';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';

jest.mock('../../../agent/execution/SettingsConsentReadServices', () => {
  const services = { resolveOwner: jest.fn(), readGrant: jest.fn() };
  return { useSettingsConsentReadServices: () => services };
});

async function setup() {
  const { result } = await renderHook(() => useInferenceConsent());
  const consent = result.current.consent;
  const onApprovalWait = jest.fn();
  const activity = {
    observer: { onTaskStreamEvent: jest.fn() },
  } as unknown as Parameters<typeof conversationPreviewObserver>[1];
  const turn = {
    invalidatePreview: jest.fn(async () => 1),
    preparePreview: jest.fn(async () => true),
  } as unknown as Parameters<
    typeof createConversationRequestPreview
  >[0]['turn'];
  const stockPreview = createConversationRequestPreview({
    turn,
    current: () => true,
    reportFailure: jest.fn(),
  });
  const preview = conversationPreviewObserver(stockPreview, activity);
  const fakePreview = conversationPreviewObserver(
    { ...stockPreview },
    activity,
  );
  const observer = { onApprovalWait, ...preview };
  const registry = new LocalEvidenceReferenceRegistry();
  const signal = new AbortController().signal;
  const selection = { modelId: 'synthetic', providerId: 'synthetic' };
  const invoke = (
    candidate: Parameters<typeof conversationRunInvocation>[0] = observer,
    scope: Parameters<typeof conversationRunInvocation>[4] = {
      signal,
      settingsConsent: consent,
    },
  ) => conversationRunInvocation(candidate, false, registry, selection, scope);
  return { observer, invoke, onApprovalWait, consent, signal, fakePreview };
}

test('stock settings and protected preview use the model-only checkpoint observer', async () => {
  const f = await setup();
  const live = f.invoke();
  expect(live.beforeTaskStream).toBeDefined();
  expect(live.onModelApprovalWait).toBeDefined();
  expect(live.onModelApprovalWait?.(true)).toBe('checkpoint-only');
  live.onModelApprovalWait?.(false);
  // An evidence or action checkpoint still has the original conservative observer.
  live.onApprovalWait?.(true);
  expect(f.onApprovalWait.mock.calls).toEqual([
    [true, 'checkpoint-only'],
    [false, 'checkpoint-only'],
    [true],
  ]);
});

test('arbitrary callback, mismatched preview capability, cloned consent or no scope is conservative', async () => {
  const f = await setup();
  const arbitraryPreview = { ...f.observer, beforeTaskStream: jest.fn() };
  const mismatchedPreview = { ...f.observer, onPreviewPrepared: jest.fn() };
  for (const invocation of [
    f.invoke(arbitraryPreview),
    f.invoke(mismatchedPreview),
    f.invoke({ ...f.observer, ...f.fakePreview }),
    f.invoke(f.observer, {
      signal: f.signal,
      settingsConsent: { ...f.consent },
    }),
    f.invoke(f.observer, f.signal),
  ]) {
    expect(invocation.onModelApprovalWait).toBeUndefined();
    expect(invocation.onApprovalWait).toBe(f.onApprovalWait);
  }
});

test('photo input and typed Visit or Daily never opt into model checkpoint-only mode', async () => {
  const f = await setup();
  for (const scope of [
    modelCheckpointScope(f.signal, f.consent, {
      intent: 'visit-questions',
      entryKey: 'test',
    }),
    modelCheckpointScope(f.signal, f.consent, {
      intent: 'daily-report',
      entryKey: 'test',
    }),
    modelCheckpointScope(f.signal, f.consent, undefined, { synthetic: true }),
  ])
    expect(f.invoke(f.observer, scope).onModelApprovalWait).toBeUndefined();
});
