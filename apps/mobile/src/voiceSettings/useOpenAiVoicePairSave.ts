import { useEffect, useRef, useState } from 'react';
import { useSettingsDisclosure } from '../agent/execution/useSettingsDisclosure';
import { t } from '../i18n';
import type { Preferences } from './liveVoicePreferences';
import {
  reviewOpenAiVoicePair,
  type OpenAiVoicePair,
} from './reviewOpenAiVoicePair';
import { saveReviewedOpenAiVoicePair } from './saveReviewedOpenAiVoicePair';

export function useOpenAiVoicePairSave(input: {
  active: boolean;
  /** Exact composed capability, never inferred from audio or a past heart grant. */
  commonTools?: true;
  pair?: OpenAiVoicePair;
  commit?: typeof saveReviewedOpenAiVoicePair;
  preferences?: Preferences;
  onSaved: (pair: OpenAiVoicePair) => void;
  onUnavailable: () => void;
}) {
  const live = useRef(input);
  live.current = input;
  const operation = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { confirmDisclosure, cancelDisclosure, disclosureSheet } =
    useSettingsDisclosure();
  const {
    active,
    commonTools,
    pair,
    preferences,
    commit = saveReviewedOpenAiVoicePair,
  } = input;
  const revision = pair?.accountRevision;
  const speech = pair?.speechModel;
  const tools = pair?.backendModel;
  useEffect(() => {
    setBusy(false);
    setError('');
    return () => {
      operation.current?.abort();
      operation.current = null;
      cancelDisclosure();
    };
  }, [
    active,
    commonTools,
    revision,
    speech,
    tools,
    preferences,
    commit,
    cancelDisclosure,
  ]);
  return {
    busy,
    error,
    disclosureSheet,
    async save() {
      if (!active || !pair || operation.current) return;
      const controller = new AbortController();
      operation.current = controller;
      const current = () => {
        const next = live.current;
        return (
          operation.current === controller &&
          !controller.signal.aborted &&
          next.active &&
          next.commonTools === commonTools &&
          next.pair?.accountRevision === revision &&
          next.pair?.speechModel === speech &&
          next.pair?.backendModel === tools &&
          next.preferences === preferences &&
          (next.commit ?? saveReviewedOpenAiVoicePair) === commit
        );
      };
      setBusy(true);
      setError('');
      try {
        let presented: () => boolean = () => false;
        const saved = await reviewOpenAiVoicePair({
          pair,
          commonTools,
          signal: controller.signal,
          current,
          review: confirmDisclosure,
          commit: async value => {
            presented = await commit({
              ...value,
              preferences,
            });
          },
        });
        if (saved && current()) {
          if (presented()) live.current.onSaved(pair);
          else live.current.onUnavailable();
        }
      } catch {
        if (current()) setError(t('modelSettings.voiceSaveFailed'));
      } finally {
        if (operation.current === controller) {
          operation.current = null;
          setBusy(false);
        }
        controller.abort();
      }
    },
  };
}
