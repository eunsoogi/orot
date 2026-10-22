import {
  createContext,
  memo,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useNextVisitQuestionsController } from '../../nextVisitQuestions/controller';
import type { NextVisitQuestionsController } from '../../nextVisitQuestions/controllerTypes';
import type { VisitQuestionEvidenceItem } from '../../agent/visitQuestions/taskContract';
import type { NextVisitQuestionsRouteProps } from './NextVisitQuestionsRoute.types';
import { useNextVisitQuestionsRoute } from './useNextVisitQuestionsRoute';
import { retainedVisitInputs } from './retainedVisitInputs';

export interface NextVisitSessionSnapshot {
  readonly route: ReturnType<typeof useNextVisitQuestionsRoute>;
  readonly controller: NextVisitQuestionsController<VisitQuestionEvidenceItem>;
}

const Context = createContext<{
  readonly snapshot: NextVisitSessionSnapshot | null;
  readonly attach: (props: NextVisitQuestionsRouteProps, view: object) => void;
} | null>(null);

/** Lazily retains visit work above navigation. Only explicit cancellation or context changes abort it.
 * Generated candidates remain in memory until the user explicitly saves the reviewed questions.
 */
export function NextVisitQuestionsSessionProvider({
  children,
  selectedAiRevision,
}: {
  readonly children: ReactNode;
  readonly selectedAiRevision: number;
}) {
  const latest = useRef<NextVisitQuestionsRouteProps | null>(null);
  const [inputs, setInputs] = useState<NextVisitQuestionsRouteProps | null>(
    null,
  );
  const [snapshot, setSnapshot] = useState<NextVisitSessionSnapshot | null>(
    null,
  );
  const currentSnapshot = useRef<NextVisitSessionSnapshot | null>(null);
  const seenViews = useRef(new WeakSet<object>());
  const publish = useCallback((value: NextVisitSessionSnapshot) => {
    currentSnapshot.current = value;
    setSnapshot(value);
  }, []);
  useLayoutEffect(() => {
    // Provider changes must invalidate in-flight work even while the visit route is absent.
    setInputs(current =>
      current && current.selectedAiRevision !== selectedAiRevision
        ? { ...current, selectedAiRevision }
        : current,
    );
  }, [selectedAiRevision]);
  const attach = useCallback(
    (props: NextVisitQuestionsRouteProps, view: object) => {
      latest.current = props;
      if (!seenViews.current.has(view)) {
        seenViews.current.add(view);
        // One bounded appointment lookup per reentry detects edits made while this screen was absent.
        void currentSnapshot.current?.route.refreshAppointment();
      }
      setInputs(current => {
        if (!current) return retainedVisitInputs(() => latest.current!);
        return current.selectedAiRevision === props.selectedAiRevision
          ? current
          : { ...current, selectedAiRevision: props.selectedAiRevision };
      });
    },
    [],
  );
  return (
    <Context.Provider value={{ snapshot, attach }}>
      {children}
      {inputs ? <SessionOwner inputs={inputs} publish={publish} /> : null}
    </Context.Provider>
  );
}

// Publication updates subscribers without rerendering this headless owner through its parent.
const SessionOwner = memo(function SessionOwner({
  inputs,
  publish,
}: {
  readonly inputs: NextVisitQuestionsRouteProps;
  readonly publish: (snapshot: NextVisitSessionSnapshot) => void;
}) {
  const route = useNextVisitQuestionsRoute(inputs);
  const controller = useNextVisitQuestionsController(route);
  useLayoutEffect(() => {
    publish({ route, controller });
  });
  return null;
});

/** Refreshes navigation callbacks on reentry while the inference owner remains mounted. */
export function useNextVisitQuestionsSession(
  props: NextVisitQuestionsRouteProps,
) {
  const context = useContext(Context);
  const attach = context?.attach;
  const view = useRef({}).current;
  useLayoutEffect(() => {
    attach?.(props, view);
  }, [attach, props, view]);
  return context;
}
