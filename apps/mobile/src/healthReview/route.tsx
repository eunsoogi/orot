import type { NavigationRouteActions } from '../navigation/NavigationRouteAdapter';
import type { AppNavigationRoute } from '../routes/appNavigationRoute';
import { HealthReviewScreen } from './HealthReviewScreen';
import { HealthReviewSourceScreen } from './HealthReviewSourceScreen';

/** App destinations retain the feature session without entering AiFeatureFlow's independent registry. */
export function HealthReviewRoute({
  actions,
}: {
  actions: NavigationRouteActions<AppNavigationRoute>;
}) {
  return actions.route.name === 'health-review-source' ? (
    <HealthReviewSourceScreen onBack={actions.onBack} />
  ) : (
    <HealthReviewScreen
      onSource={() => actions.push('health-review-source')}
      onProvider={() => actions.push('settings-provider')}
    />
  );
}
