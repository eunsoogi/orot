import type { HealthContextReport } from '../../healthEvidence/healthContext/types';
import type { HealthContextScope } from '../../healthEvidence/healthContext/scope';
import { projectHealthContext } from '../../healthEvidence/healthContext/projection';
import { healthContextContent } from '../../aiFeatures/integration/healthContextEvidence';

/** Local save/restore facts cover every supported projection of the same bounded, revalidated period.
 * Tool-selected provider payloads keep their own detail and byte limits; this envelope is never a tool result.
 */
export function completeVisitHealthContextFacts(
  scope: HealthContextScope,
  report: HealthContextReport,
): string {
  const prefix = 'health_context: ';
  // Parse only app-generated JSON, never a citation's model-editable content.
  const daily = JSON.parse(
    healthContextContent(scope, report, 'daily').slice(prefix.length),
  ) as Record<string, unknown>;
  if (scope.topic === 'measurements' || scope.topic === 'activity') {
    const weekly = projectHealthContext(report, 'weekly');
    daily.quantities = projectHealthContext(report, 'daily').quantities.map(
      (series, index) => ({
        ...series,
        weeks: weekly.quantities[index]?.weeks,
      }),
    );
  }
  return prefix + JSON.stringify(daily);
}
