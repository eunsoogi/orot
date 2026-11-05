import { useMemo, useState } from 'react';
import { useInferenceConsent } from '../../../agent/execution/useInferenceConsent';
import { Button } from 'react-native';
import { NavigationRouteAdapter } from '../../../navigation/NavigationRouteAdapter';
import { createNavigationController } from '../../../navigation/navigationController';
import { appContentLayoutOwner } from '../../../navigation/appContentLayoutPolicy';
import { AiFeatureFlow } from '../AiFeatureFlow';
import { AiFeatureSharedNavigationStateProvider } from '../AiFeatureSharedNavigationState';
import { createAiFeatureServices } from '../featureServices';
import type { AiFeatureServiceDependencies } from '../featureServices';
import type { AiFeatureRouteName } from '../aiFeatureNavigation';
import type { VisitQuestionsRenderInput } from '../AiFeatureFlowScreen';
import type { ReactElement } from 'react';

/** Exercises the retained editable module with the shipping adapter and overlay flow.
 * This test mount control is not a product entry; production saved-result entry is read-only.
 */
export function RetainedVisitModuleHarness({
  dependencies,
  renderModule,
}: {
  readonly dependencies: AiFeatureServiceDependencies;
  readonly renderModule: (input: VisitQuestionsRenderInput) => ReactElement;
}) {
  const [controller] = useState(() =>
    createNavigationController<AiFeatureRouteName>('app-home'),
  );
  const { consent, disclosureSheet } = useInferenceConsent();
  const services = useMemo(
    () => createAiFeatureServices(consent, dependencies),
    [consent, dependencies],
  );
  const options = useMemo(
    () => services.conversationSessionOptions(),
    [services],
  );
  return (
    <AiFeatureSharedNavigationStateProvider
      conversationSessionOptions={options}
    >
      <NavigationRouteAdapter
        controller={controller}
        contentLayoutOwner={appContentLayoutOwner}
        showHome
        leaveState={{
          readState: () => ({
            hasUnsavedChanges: false,
            isRecording: false,
            hasOngoingOperation: false,
            revision: 0,
            inputRevision: 0,
          }),
        }}
      >
        {navigation =>
          navigation.route.name === 'app-home' ? (
            <Button
              testID="retained-visit-module-open"
              title="Mount retained visit module"
              onPress={() => navigation.push('saved-visit-questions')}
            />
          ) : (
            <AiFeatureFlow
              navigation={navigation}
              consent={consent}
              services={services}
              serviceDependencies={dependencies}
              onOpenArticle={async () => undefined}
              renderVisitQuestions={renderModule}
            />
          )
        }
      </NavigationRouteAdapter>
      {disclosureSheet}
    </AiFeatureSharedNavigationStateProvider>
  );
}
