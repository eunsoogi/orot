import { compareTimestamps, TimestampSchema } from '@orot/domain';
import type { AppointmentRepository } from '@orot/storage';

export interface AutomaticRecordingVisit {
  readonly id: string;
  readonly effectiveAt: string;
  readonly status: 'scheduled';
}

type RepositoryLoader = () => Promise<Pick<AppointmentRepository, 'list'>>;

async function loadRepository() {
  const { openLocalAppointmentRepository } =
    await import('../storage/secureDatabase');
  return openLocalAppointmentRepository();
}

/** Snapshot only explicitly stored future visits, never infer a visit from calendar text. */
export async function selectAutomaticRecordingVisit(
  now: string,
  load: RepositoryLoader = loadRepository,
): Promise<AutomaticRecordingVisit | null> {
  if (!TimestampSchema.safeParse(now).success) return null;
  try {
    const appointments = await (await load()).list();
    const eligible = appointments.filter(
      visit =>
        visit.status === 'scheduled' &&
        visit.id.trim().length > 0 &&
        TimestampSchema.safeParse(visit.effectiveAt).success &&
        compareTimestamps(visit.effectiveAt, now) > 0,
    );
    eligible.sort((left, right) => {
      const byTime = compareTimestamps(left.effectiveAt, right.effectiveAt);
      if (byTime !== 0) return byTime;
      return left.id === right.id ? 0 : left.id < right.id ? -1 : 1;
    });
    const selected = eligible[0];
    return selected
      ? {
          id: selected.id,
          effectiveAt: selected.effectiveAt,
          status: 'scheduled',
        }
      : null;
  } catch {
    // Locked/unavailable storage must not block recording or guess a relationship.
    return null;
  }
}

/** Preflight only: the binding transaction must repeat this check to close read/write races.
 * Do not choose a replacement or reject a stable visit merely because recording took time. */
export async function revalidateAutomaticRecordingVisit(
  selected: AutomaticRecordingVisit | null,
  load: RepositoryLoader = loadRepository,
): Promise<string | null> {
  if (!selected || !TimestampSchema.safeParse(selected.effectiveAt).success)
    return null;
  try {
    const appointments = await (await load()).list();
    return appointments.some(
      visit =>
        visit.id === selected.id &&
        visit.effectiveAt === selected.effectiveAt &&
        visit.status === 'scheduled' &&
        selected.status === 'scheduled',
    )
      ? selected.id
      : null;
  } catch {
    return null;
  }
}
