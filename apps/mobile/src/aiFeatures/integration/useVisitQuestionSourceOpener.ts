import { useCallback, useRef } from 'react';
import type { EvidenceItem } from '@orot/agent-runtime';
import type { VisitQuestionEvidenceItem } from '../../agent/visitQuestions/taskContract';
import type { VisitQuestionsRenderInput } from './AiFeatureFlowScreen';

type SourceRouteInput = Pick<
  VisitQuestionsRenderInput,
  'onOpenSource' | 'registerVisitQuestionSource' | 'resolveSource'
>;

/** Keeps a live visit validator attached while the screen opens original sources. */
export function useVisitQuestionSourceOpener(props: SourceRouteInput) {
  const {
    onOpenSource: openSource,
    registerVisitQuestionSource,
    resolveSource,
  } = props;
  const validator = useRef<
    | ((
        reference: VisitQuestionEvidenceItem,
        signal: AbortSignal,
      ) => Promise<boolean>)
    | null
  >(null);

  const rememberValidator = useCallback(
    (
      validate: (
        reference: VisitQuestionEvidenceItem,
        signal: AbortSignal,
      ) => Promise<boolean>,
    ) => {
      validator.current = validate;
    },
    [],
  );
  const onOpenSource = useCallback(
    (reference: EvidenceItem) => {
      if (resolveSource(reference)) {
        openSource(reference);
        return;
      }
      const validate = validator.current;
      if (!validate) {
        openSource(reference);
        return;
      }
      // Register only with the validator captured from the same live visit context.
      const citation = reference as VisitQuestionEvidenceItem;
      const registered = registerVisitQuestionSource(citation, signal =>
        validate(citation, signal),
      );
      openSource(registered);
    },
    [openSource, registerVisitQuestionSource, resolveSource],
  );

  return { onOpenSource, rememberValidator };
}
