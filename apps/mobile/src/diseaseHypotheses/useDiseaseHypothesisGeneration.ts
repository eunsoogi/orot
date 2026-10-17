import { useEffect, useRef, useState } from 'react';
import type { ProviderErrorCode } from '@orot/model-runtime';
import type { MultiAgentInvocation } from '@orot/agent-runtime';
import type {
  DiseaseHypothesisAnalysis,
  DiseaseHypothesisRunOutcome,
} from './task';
import {
  applyWorkflowStreamEvent,
  workflowProgressLabel,
} from '../agent/workflowActivity';
import type { AiWorkflowObserver } from '../agent/workflowActivity';
import { t } from '../i18n';

type ScreenState =
  | { readonly status: 'idle' | 'loading' | 'cancelled' | 'insufficient' }
  | { readonly status: 'result'; readonly value: DiseaseHypothesisAnalysis }
  | {
      readonly status: 'error';
      readonly providerErrorCode?: ProviderErrorCode;
    };

type DiseaseHypothesisGenerator = (
  signal?: AbortSignal,
  observer?: AiWorkflowObserver,
) => Promise<DiseaseHypothesisRunOutcome>;

/** Owns one cancellable run and ignores activity emitted after cancel or unmount. */
export function useDiseaseHypothesisGeneration(
  onGenerate: DiseaseHypothesisGenerator,
) {
  const [state, setState] = useState<ScreenState>({ status: 'idle' });
  const [activity, setActivity] = useState<string>();
  const [preview, setPreview] = useState('');
  const operationController = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      const controller = operationController.current;
      operationController.current = null;
      controller?.abort();
    },
    [],
  );

  async function generate() {
    if (operationController.current) return;
    const controller = new AbortController();
    operationController.current = controller;
    const isCurrent = () =>
      operationController.current === controller && !controller.signal.aborted;
    setState({ status: 'loading' });
    setActivity(t('aiActivity.preparing'));
    setPreview('');

    const observer: Pick<
      MultiAgentInvocation,
      'onProgress' | 'onTaskStreamEvent'
    > = {
      onProgress: event => {
        if (isCurrent()) setActivity(workflowProgressLabel(event));
      },
      onTaskStreamEvent: event => {
        if (isCurrent()) {
          setPreview(current => applyWorkflowStreamEvent(current, event));
        }
      },
    };

    try {
      const outcome = await onGenerate(controller.signal, observer);
      if (!isCurrent()) return;
      setActivity(undefined);
      setPreview('');
      if (outcome.status === 'incomplete_inventory') {
        setState({ status: 'insufficient' });
      } else if (outcome.result.status === 'result') {
        setState({ status: 'result', value: outcome.result.value });
      } else if (outcome.result.status === 'needs_clarification') {
        setState({ status: 'insufficient' });
      } else if (outcome.result.status === 'cancelled') {
        setState({ status: 'cancelled' });
      } else {
        setState({
          status: 'error',
          providerErrorCode:
            outcome.result.status === 'unavailable'
              ? outcome.result.providerErrorCode
              : undefined,
        });
      }
    } catch {
      if (isCurrent()) {
        setActivity(undefined);
        setPreview('');
        setState({ status: 'error' });
      }
    } finally {
      if (operationController.current === controller) {
        operationController.current = null;
      }
    }
  }

  function cancel() {
    const controller = operationController.current;
    if (!controller) return;
    operationController.current = null;
    controller.abort();
    setActivity(undefined);
    setPreview('');
    setState({ status: 'cancelled' });
  }

  return { state, activity, preview, generate, cancel };
}
