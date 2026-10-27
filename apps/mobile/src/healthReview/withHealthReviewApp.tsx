import type { ComponentType } from 'react';
import { HealthReviewSessionProvider } from './HealthReviewSession';
import type { HealthReviewService } from './service';

/** The outer App lifetime retains the session; the optional native fixture still invokes the production service. */
export function withHealthReviewApp<P extends object>(
  Component: ComponentType<P>,
) {
  return function HealthReviewApp({
    healthReviewService,
    ...props
  }: P & { healthReviewService?: HealthReviewService }) {
    return (
      <HealthReviewSessionProvider service={healthReviewService}>
        <Component {...(props as P)} />
      </HealthReviewSessionProvider>
    );
  };
}
