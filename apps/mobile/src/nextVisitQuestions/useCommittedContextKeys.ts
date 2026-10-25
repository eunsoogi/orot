import { useLayoutEffect, useRef } from 'react';

export interface CommittedContextKeys {
  readonly appointment: string;
  readonly provider: string;
  readonly appointmentRevision: number;
}

/** Publishes committed visit revisions so abandoned renders cannot affect replies and A-B-A switches remain distinct. */
export function useCommittedContextKeys(appointment: string, provider: string) {
  const current = useRef<CommittedContextKeys>({
    appointment,
    provider,
    appointmentRevision: 0,
  });

  useLayoutEffect(() => {
    const previous = current.current;
    current.current = {
      appointment,
      provider,
      appointmentRevision:
        previous.appointment === appointment
          ? previous.appointmentRevision
          : previous.appointmentRevision + 1,
    };
  }, [appointment, provider]);

  return current;
}
