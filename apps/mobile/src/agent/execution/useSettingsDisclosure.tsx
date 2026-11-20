import { useCallback, useEffect, useRef, useState } from 'react';
import type { SettingsDisclosureSummary } from './settingsDisclosureSummary';
import InferenceDisclosureSheet from './InferenceDisclosureSheet';

type Pending = {
  summary: SettingsDisclosureSummary;
  finish: (approved: boolean) => void;
};

/** This settings-only presentation returns a decision; only the existing settings writer can grant permission. */
export function useSettingsDisclosure() {
  const [visible, setVisible] = useState<Pending | null>(null);
  const pending = useRef<Pending | null>(null);
  const active = useRef(false);
  const cancelDisclosure = useCallback(
    () => pending.current?.finish(false),
    [],
  );
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      cancelDisclosure();
    };
  }, [cancelDisclosure]);
  const confirmDisclosure = useCallback(
    (
      value: SettingsDisclosureSummary,
      signal?: AbortSignal,
    ): Promise<boolean> => {
      if (!active.current || pending.current || signal?.aborted)
        return Promise.resolve(false);
      return new Promise(resolve => {
        const cancel = () => entry.finish(false);
        const entry: Pending = {
          summary: value,
          finish(approved) {
            if (pending.current !== entry) return;
            pending.current = null;
            signal?.removeEventListener('abort', cancel);
            if (active.current) setVisible(null);
            resolve(approved && active.current && !signal?.aborted);
          },
        };
        pending.current = entry;
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
        else setVisible(entry);
      });
    },
    [],
  );
  return {
    confirmDisclosure,
    cancelDisclosure,
    disclosureSheet: visible ? (
      <InferenceDisclosureSheet
        summary={visible.summary}
        onDecision={approved => {
          const current = pending.current;
          if (current === visible) current.finish(approved);
        }}
      />
    ) : null,
  };
}
