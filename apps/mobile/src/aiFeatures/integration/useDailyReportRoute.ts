import { useCallback, useEffect, useRef, useState } from 'react';
import type { DailyReportIdentity } from '@orot/domain';
import type { createDailyReportFeature } from './dailyReportFeature';

type Feature = ReturnType<typeof createDailyReportFeature>;
type Lookup = Awaited<ReturnType<Feature['lookup']>>;
type Preview = Awaited<ReturnType<Feature['preview']>>;

/** Discards old lookups when date changes; the shared service owns the in-flight run. */
export function useDailyReportRoute(
  feature: Feature,
  identity: DailyReportIdentity | null,
  initialOperation?: ReturnType<Feature['start']>,
  ownsOperation = true,
) {
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const identityRef = useRef(identity?.key);
  identityRef.current = identity?.key;
  const generationRef = useRef(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
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
    operation.result.then(
      result => {
        if (!current) return;
        setBusy(false);
        cancelRef.current = null;
        if (result.status === 'failed') setFailure(result.code);
        else refresh();
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
  }, [feature, identity, initialOperation, ownsOperation, refresh]);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setLookup(null);
    setPreview(null);
    setLoading(true);
    if (!identity) {
      setLoading(false);
      return () => controller.abort();
    }
    Promise.all([
      feature.lookup(identity),
      feature.preview(identity, controller.signal),
    ]).then(
      ([saved, data]) => {
        if (current) {
          setLookup(saved);
          setPreview(data);
          setLoading(false);
        }
      },
      () => {
        if (current) {
          setLookup({ status: 'error' });
          setLoading(false);
        }
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [feature, identity, revision]);
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
    setBusy(true);
    setFailure(null);
    operation.result.then(
      result => {
        if (!isCurrent()) return;
        setBusy(false);
        cancelRef.current = null;
        if (result.status === 'failed') setFailure(result.code);
        else refresh();
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
    loading,
    busy,
    failure,
    generate,
    refresh,
    cancel: () => cancelRef.current?.(),
  };
}
