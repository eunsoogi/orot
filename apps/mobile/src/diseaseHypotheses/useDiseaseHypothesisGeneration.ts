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
  restoredSummary?: DiseaseHypothesisAnalysis,
) {
  const [state, setState] = useState<ScreenState>({ status: 'idle' });
  const [activity, setActivity] = useState<string>();
  const [preview, setPreview] = useState('');
  const [lastOperation, setLastOperation] = useState<'summary' | 'assessment'>(
    'assessment',
  );
  const operationController = useRef<AbortController | null>(null);

  // The native history route returns a saved value to this retained scene, without another model call.
  useEffect(() => {
    if (restoredSummary && !operationController.current) {
      setPreview('');
      setLastOperation(
        restoredSummary.presentation === 'symptom_summary'
          ? 'summary'
          : 'assessment',
      );
      setState({ status: 'result', value: restoredSummary });
    }
  }, [restoredSummary]);

  useEffect(
    () => () => {
      const controller = operationController.current;
      operationController.current = null;
      controller?.abort();
    },
    [],
  );

  async function generate(
    generator: DiseaseHypothesisGenerator = onGenerate,
    operation: 'summary' | 'assessment' = 'assessment',
  ) {
    if (operationController.current) return;
    const controller = new AbortController();
    operationController.current = controller;
    // Retrying a summary must never silently select the separate disease-assessment operation.
    setLastOperation(operation);
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
      const outcome = await generator(controller.signal, observer);
      if (!isCurrent()) return;
      setActivity(undefined);
      // Keep display-approved partial text when a run cannot finish validation.
      if (outcome.status === 'incomplete_inventory') {
        setState({ status: 'insufficient' });
      } else if (outcome.result.status === 'result') {
        setPreview('');
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
    setState({ status: 'cancelled' });
  }

  return {
    lastOperation,
    state,
    activity,
    preview,
    generate,
    cancel,
    restore: (value: DiseaseHypothesisAnalysis) => {
      if (!operationController.current) {
        setPreview('');
        setLastOperation(
          value.presentation === 'symptom_summary' ? 'summary' : 'assessment',
        );
        setState({ status: 'result', value });
      }
    },
  };
}
