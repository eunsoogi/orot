import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import type { PropsWithChildren } from 'react';
import type { EvidenceReference } from '@orot/agent-runtime';
import { useInferenceConsent } from '../agent/execution/useInferenceConsent';
import { HealthReviewController } from './controller';
import { createHealthReviewService } from './service';
import type { HealthReviewService } from './service';
import type { createHealthReviewInvocation } from './evidenceInvocation';

type Citation = {
  reference: EvidenceReference;
  readSource: ReturnType<typeof createHealthReviewInvocation>['readSource'];
};
function useSession(service?: HealthReviewService) {
  const [controller] = useState(
    () => new HealthReviewController(service ?? createHealthReviewService()),
  );
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const inference = useInferenceConsent();
  const [citation, setCitation] = useState<Citation>();
  useEffect(() => () => controller.cancel(), [controller]);
  return { controller, state, ...inference, citation, setCitation };
}
const Session = createContext<ReturnType<typeof useSession> | null>(null);

/** Mount above the navigation adapter so draft, operation, consent and alias ownership survive route changes. */
export function HealthReviewSessionProvider({
  children,
  service,
}: PropsWithChildren<{ service?: HealthReviewService }>) {
  const session = useSession(service);
  return (
    <Session.Provider value={session}>
      {children}
      {session.disclosureSheet}
    </Session.Provider>
  );
}
export function useHealthReviewSession() {
  const session = useContext(Session);
  if (!session) throw new Error('Health review session provider required.');
  return session;
}
