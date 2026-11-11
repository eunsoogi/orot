import { useCallback, useEffect, useRef, useState } from 'react';
import type { DailyReportIdentity } from '@orot/domain';
import type { createDailyReportFeature } from './dailyReportFeature';
import type { DailyReportFailureCode } from './dailyReportTypes';
import type { ConversationEntryContext } from './conversationIntent';
import { useReportResultCommit } from './useReportResultCommit';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../../storage/localDataClearEvents';

type Feature = ReturnType<typeof createDailyReportFeature>;
type Lookup = Awaited<ReturnType<Feature['lookup']>>;
type Preview = Awaited<ReturnType<Feature['preview']>>;

/** Discards old lookups when date changes; the shared service owns the in-flight run. */
export function useDailyReportRoute(
  feature: Feature,
  identity: DailyReportIdentity | null,
  initialOperation?: ReturnType<Feature['start']>,
  ownsOperation = true,
  onTaskResult?: (
    target: NonNullable<ConversationEntryContext['dailyReport']>,
  ) => Promise<void>,
) {
  const resultCommit = useReportResultCommit(feature, onTaskResult);
  const { capture, beginCaptured } = resultCommit;
  const [lookupResult, setLookup] = useState<{
    key: string;
    value: Lookup;
  } | null>(null);
  const [previewResult, setPreview] = useState<{
    key: string;
    value: Preview;
  } | null>(null);
  const lookup =
    lookupResult?.key === identity?.key ? (lookupResult?.value ?? null) : null;
  const preview =
    previewResult?.key === identity?.key
      ? (previewResult?.value ?? null)
      : null;
  const [lookupRevision, setLookupRevision] = useState(0);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<DailyReportFailureCode | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const identityRef = useRef(identity?.key);
  identityRef.current = identity?.key;
  const generationRef = useRef(0);
  const lookupGenerationRef = useRef(0);
  const previewGenerationRef = useRef(0);
  const refreshLookup = useCallback(() => {
    lookupGenerationRef.current += 1;
    setLookup(null);
    setLookupRevision(value => value + 1);
  }, []);
  const refreshPreview = useCallback(() => {
    previewGenerationRef.current += 1;
    setPreview(null);
    setPreviewRevision(value => value + 1);
  }, []);
  const refresh = useCallback(() => {
    // Invalidation must clear both regions and fence pending reads before the next effect.
    refreshLookup();
    refreshPreview();
  }, [refreshLookup, refreshPreview]);
  const retry = () => {
    // A transient failure in one region does not invalidate a valid sibling result.
    if (lookup?.status === 'error') refreshLookup();
    if (preview?.status === 'error') refreshPreview();
    if (failure === 'report_read_failed') {
      setFailure(null);
      refreshLookup();
    }
  };
  const identityKey = identity?.key;
  useEffect(() => {
    if (!identityKey) return;
    const invalidate = () => refresh();
    const unsubscribeClear = subscribeLocalDataClear(invalidate);
    const unsubscribeSource = subscribeLocalSourceDeletion(invalidate);
    return () => {
      unsubscribeClear();
      unsubscribeSource();
    };
  }, [identityKey, refresh]);
  useEffect(() => {
    let current = true;
    generationRef.current += 1;
    setBusy(false);
    setFailure(null);
    cancelRef.current = null;
    const release = ownsOperation && identity ? feature.retain(identity) : null;
    const operation =
      initialOperation?.status === 'started'
        ? initialOperation
        : identity
          ? feature.active(identity)
          : null;
    if (!operation) {
      if (initialOperation && initialOperation.status !== 'started')
        setFailure(initialOperation.status);
      return () => {
        current = false;
        generationRef.current += 1;
        release?.();
      };
    }
    setBusy(true);
    cancelRef.current = operation.cancel;
    const retain = capture();
    operation.result.then(
      result => {
        if (result.status !== 'failed' && identity)
          beginCaptured(identity, result.runId, retain);
        if (!current) return;
        setBusy(false);
        cancelRef.current = null;
        if (result.status === 'failed') {
          setFailure(result.code);
          // This failure means the previously saved source snapshot may no longer be safe to show.
          if (result.code === 'source_revision_changed') refresh();
        } else refresh();
      },
      () => {
        if (current) {
          setBusy(false);
          cancelRef.current = null;
          setFailure('error');
        }
      },
    );
    return () => {
      current = false;
      generationRef.current += 1;
      release?.();
    };
  }, [
    feature,
    identity,
    initialOperation,
    ownsOperation,
    refresh,
    capture,
    beginCaptured,
  ]);
  useEffect(() => {
    const generation = ++lookupGenerationRef.current;
    setLookup(null);
    if (!identity) return;
    let current = true;
    const settle = (value: Lookup) => {
      if (
        current &&
        identityRef.current === identity.key &&
        generation === lookupGenerationRef.current
      )
        setLookup({ key: identity.key, value });
    };
    feature.lookup(identity).then(settle, () => settle({ status: 'error' }));
    return () => {
      current = false;
    };
  }, [feature, identity, lookupRevision]);
  useEffect(() => {
    const generation = ++previewGenerationRef.current;
    setPreview(null);
    if (!identity) return;
    const controller = new AbortController();
    const settle = (value: Preview) => {
      if (
        !controller.signal.aborted &&
        identityRef.current === identity.key &&
        generation === previewGenerationRef.current
      )
        setPreview({ key: identity.key, value });
    };
    feature
      .preview(identity, controller.signal)
      .then(settle, () => settle({ status: 'error' }));
    return () => controller.abort();
  }, [feature, identity, previewRevision]);
  const generate = () => {
    if (!identity || !lookup || busy) return;
    const ownerKey = identity.key;
    const generation = generationRef.current;
    const isCurrent = () =>
      identityRef.current === ownerKey && generationRef.current === generation;
    const mode =
      lookup.status === 'saved' || lookup.status === 'stale'
        ? { kind: 'revise' as const, expectedRunId: lookup.runId }
        : lookup.status === 'deleted'
          ? { kind: 'revise' as const, expectedRunId: null }
          : { kind: 'reuse_or_generate' as const };
    const operation = feature.start(identity, mode);
    if (operation.status !== 'started') {
      setFailure(operation.status);
      return;
    }
    cancelRef.current = operation.cancel;
    const retain = capture();
    setBusy(true);
    setFailure(null);
    operation.result.then(
      result => {
        if (result.status !== 'failed')
          beginCaptured(identity, result.runId, retain);
        if (!isCurrent()) return;
        setBusy(false);
        cancelRef.current = null;
        if (result.status === 'failed') {
          setFailure(result.code);
          // Provider and consent failures leave the prior report intact; source changes require a fresh lookup.
          if (result.code === 'source_revision_changed') refresh();
        } else refresh();
      },
      () => {
        if (!isCurrent()) return;
        setBusy(false);
        cancelRef.current = null;
        setFailure('error');
      },
    );
  };
  return {
    lookup,
    preview,
    loading: Boolean(identity && (!lookup || !preview)),
    busy: busy || resultCommit.status === 'pending',
    resultSaveFailed: resultCommit.status === 'failed',
    retryResult: resultCommit.retry,
    retainResult: resultCommit.begin,
    failure,
    generate,
    refresh,
    retry,
    cancel: () => cancelRef.current?.(),
  };
}
