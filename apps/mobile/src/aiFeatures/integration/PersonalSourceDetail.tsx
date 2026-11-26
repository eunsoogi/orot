import { waitForSourcePresentation } from '../../ragConversation/publicSourcePresentation';
import { forwardSourceOpenTiming } from '../../providers/sourceOpenDiagnostic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AppText } from '../../layout/AppText';
import { t } from '../../i18n';
import type { NavigationRouteActions } from '../../navigation/navigationRouteContracts';
import type { AiFeatureRouteName } from './aiFeatureNavigation';
import type { AiFeatureSharedNavigationState } from './AiFeatureSharedNavigationState';
import { useAiFeatureScreenNavigationState } from './useAiFeatureNavigationState';
import type { AiFeatureNavigationStateChange } from './useAiFeatureNavigationState';
import type { AiFeatureServices } from './featureServices';
import type { PendingPersonalSource } from './usePendingPersonalSource';
import { EvidenceSourceDetailScreen } from './EvidenceSourceDetailScreen';
import { styles } from './AiFeatureFlow.styles';

type Props = {
  navigation: NavigationRouteActions<AiFeatureRouteName>;
  onBack: () => void;
  onNavigationStateChange: AiFeatureNavigationStateChange;
  services: AiFeatureServices;
  shared: AiFeatureSharedNavigationState;
  sourceDetailOpen: boolean;
  sourceReference: EvidenceReference | null;
};

function PendingDetail({
  pending,
  ...props
}: Props & { pending: PendingPersonalSource }) {
  const { lease } = pending;
  useAiFeatureScreenNavigationState(
    pending.routeKey,
    {
      hasUnsavedChanges: false,
      isRecording: false,
      hasOngoingOperation: false,
    },
    0,
    props.onNavigationStateChange,
  );
  const presented = useRef(() => {});
  const [admitted, setAdmitted] = useState<EvidenceReference>();
  const [unavailable, setUnavailable] = useState(lease.signal.aborted);
  const read = useCallback<AiFeatureServices['readSource']>(
    async (reference, signal) => {
      if (!lease.current() || signal.aborted) return { status: 'unavailable' };
      const controller = new AbortController();
      forwardSourceOpenTiming(signal, controller.signal);
      const retire = () => controller.abort();
      lease.signal.addEventListener('abort', retire, { once: true });
      signal.addEventListener('abort', retire, { once: true });
      try {
        const result = await props.services.readSource(
          reference,
          controller.signal,
        );
        return lease.current() && !controller.signal.aborted
          ? result
          : { status: 'unavailable' };
      } finally {
        lease.signal.removeEventListener('abort', retire);
        signal.removeEventListener('abort', retire);
      }
    },
    [lease, props.services],
  );

  useEffect(() => {
    const revoke = () => setUnavailable(true);
    lease.signal.addEventListener('abort', revoke, { once: true });
    const presentation = waitForSourcePresentation(lease.signal, 160);
    presented.current = presentation.shown;
    if (lease.signal.aborted) revoke();
    else {
      const admit = async () => {
        if (!(await presentation.ready) || !lease.current()) return;
        try {
          const reference = await lease.admit();
          if (reference && lease.current()) setAdmitted(reference);
          else revoke();
        } catch {
          revoke();
        }
      };
      admit();
    }
    return () => {
      lease.signal.removeEventListener('abort', revoke);
      presented.current = () => {};
    };
  }, [lease]);

  if (!admitted || unavailable || lease.signal.aborted)
    return (
      <View
        testID="ai-feature-source-detail"
        onLayout={() => presented.current()}
      >
        <AppText
          testID={
            unavailable
              ? 'ai-feature-source-unavailable'
              : 'ai-feature-source-loading'
          }
        >
          {t(
            unavailable
              ? 'aiFeatures.source.unavailable'
              : 'aiFeatures.source.loading',
          )}
        </AppText>
      </View>
    );
  return (
    <EvidenceSourceDetailScreen
      navigationRouteKey={props.navigation.route.key}
      onBack={props.onBack}
      reference={admitted}
      readSource={read}
    />
  );
}

/** A pending sheet has no reference or document until the first admission succeeds. */
export function PersonalSourceDetail(props: Props) {
  const { sourceDetailOpen, sourceReference, navigation, shared, services } =
    props;
  if (!sourceDetailOpen) return null;
  const pending = shared.pendingPersonalSource;
  if (pending?.routeKey === navigation.route.key)
    return (
      <View style={styles.sourceOverlay}>
        <PendingDetail key={pending.routeKey} pending={pending} {...props} />
      </View>
    );
  if (!sourceReference) return null;
  return (
    <View style={styles.sourceOverlay}>
      <EvidenceSourceDetailScreen
        key={JSON.stringify([sourceReference, shared.sourceOwner])}
        navigationRouteKey={navigation.route.key}
        onNavigationStateChange={props.onNavigationStateChange}
        onBack={props.onBack}
        readSource={services.readSource}
        readColdSource={services.readColdConversationSource}
        sourceOwner={shared.sourceOwner}
        reference={sourceReference}
      />
    </View>
  );
}
