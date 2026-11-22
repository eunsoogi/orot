import { useState } from 'react';
import { AppButton } from '../../layout/AppButton';
import { OverviewPreparedVisits } from '../../routes/OverviewPreparedVisits';
import { ConversationScreen } from '../ConversationScreen';
import type { AiFeatureServices } from '../../aiFeatures/integration/featureServiceTypes';

/** Switch only the visible destination while retaining the same protected conversation owner. */
export function RestoredVisitDestinations({
  discover,
  visit,
}: {
  discover: AiFeatureServices['conversationArtifacts'];
  visit: string;
}) {
  const [overview, setOverview] = useState(false);
  return overview ? (
    <OverviewPreparedVisits appointmentId={visit} />
  ) : (
    <>
      <ConversationScreen
        onBack={() => {}}
        onOpenSource={() => {}}
        onSend={async () => ({ status: 'failure', kind: 'retrieval_failed' })}
        discoverManualVisits={discover}
      />
      <AppButton title="한눈에" onPress={() => setOverview(true)} />
    </>
  );
}
