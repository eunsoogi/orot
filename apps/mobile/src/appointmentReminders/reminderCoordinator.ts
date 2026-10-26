import type { Appointment } from '@orot/storage';
import {
  buildAppointmentReminder,
  resolveAppointmentReminderTarget,
} from './reminderPlan';
import type {
  AppointmentReminderPlan,
  AppointmentReminderSelection,
} from './reminderPlan';

export type ReminderAuthorization = 'notDetermined' | 'authorized' | 'denied';

/** Native persistence stores the opt-in identity/duration, never appointment text. */
export interface AppointmentReminderPort {
  readSelection(): Promise<AppointmentReminderSelection | null>;
  writeSelection(value: AppointmentReminderSelection | null): Promise<void>;
  authorizationStatus(): Promise<ReminderAuthorization>;
  requestAuthorization(): Promise<ReminderAuthorization>;
  /** Replaces only this feature's pending request and removes obsolete delivered alerts. */
  replace(plan: AppointmentReminderPlan | null): Promise<void>;
}

export interface AppointmentReminderState {
  readonly selection: AppointmentReminderSelection | null;
  readonly status: 'idle' | 'scheduled' | 'unscheduled' | 'denied' | 'error';
  readonly busy: boolean;
}

/**
 * Serializes opt-in and lifecycle/mutation reconciliation so an older read cannot
 * reinstall a cancelled or moved visit. Reconciliation never asks for permission.
 */
export class AppointmentReminderCoordinator {
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private state: AppointmentReminderState = {
    selection: null,
    status: 'idle',
    busy: false,
  };

  constructor(
    private readonly appointments: () => Promise<readonly Appointment[]>,
    private readonly port: AppointmentReminderPort,
    private readonly clock: () => number = Date.now,
  ) {}

  readonly getSnapshot = (): AppointmentReminderState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly reconcile = (): Promise<void> => this.enqueue(() => this.sync());

  /** Called only by an explicit user action; background refresh cannot opt in. */
  readonly select = (
    selection: AppointmentReminderSelection | null,
  ): Promise<void> =>
    this.enqueue(async () => {
      if (selection) {
        const access = await this.port.requestAuthorization();
        if (access !== 'authorized') {
          await this.port.replace(null);
          this.publish({ ...this.state, status: 'denied' });
          return;
        }
      }
      await this.port.writeSelection(selection);
      // Permission prompts may outlive an edit. Read the repository after the reply.
      await this.sync();
    });

  private async sync(): Promise<void> {
    const selection = await this.port.readSelection();
    this.publish({ ...this.state, selection });
    const access = await this.port.authorizationStatus();
    const plan =
      selection && access === 'authorized'
        ? buildAppointmentReminder(
            await this.appointments(),
            selection,
            this.clock(),
          )
        : null;
    await this.port.replace(plan);
    this.publish({
      selection,
      busy: true,
      status:
        selection && access !== 'authorized'
          ? 'denied'
          : plan
            ? 'scheduled'
            : 'unscheduled',
    });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.queue.then(async () => {
      this.publish({ ...this.state, busy: true });
      try {
        await operation();
      } catch {
        // An unreadable current visit cannot justify retaining an old reminder.
        // Keep an observable error even if clearing the OS request also fails.
        try {
          await this.port.replace(null);
        } catch {
          // Foreground reconciliation retries cleanup; never report a schedule here.
        }
        this.publish({ ...this.state, status: 'error' });
        throw new Error('Appointment reminders could not be updated.');
      } finally {
        this.publish({ ...this.state, busy: false });
      }
    });
    // One failure must not poison later foreground recovery or explicit opt-out.
    this.queue = next.catch(() => undefined);
    return next;
  }

  private publish(state: AppointmentReminderState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

export interface AppointmentReminderDeliveryPort {
  consumeTarget(): Promise<unknown>;
  loadAppointments(): Promise<readonly Appointment[]>;
  /** Uses the existing navigation leave guard; a notification cannot discard active work. */
  confirmNavigation(): Promise<boolean>;
  /** Synchronous commit after revalidation; opening the screen must not start AI work. */
  openVisitPreparation(appointment: Appointment): boolean;
  onUnavailable(reason: 'stale' | 'error'): void;
}

export type AppointmentReminderDeliveryResult =
  'empty' | 'opened' | 'declined' | 'deferred' | 'stale' | 'error';

/**
 * One serialized inbox drain serves both cold-start and foreground taps. Keep a
 * consumed target across read failures, but never fall back to another visit.
 */
export function createAppointmentReminderDelivery(
  port: AppointmentReminderDeliveryPort,
  clock: () => number = Date.now,
): () => Promise<AppointmentReminderDeliveryResult> {
  let queue: Promise<void> = Promise.resolve();
  let retained: unknown = null;
  return () => {
    const delivery: Promise<AppointmentReminderDeliveryResult> = queue.then(
      async (): Promise<AppointmentReminderDeliveryResult> => {
        try {
          const incoming = await port.consumeTarget();
          if (incoming !== null) retained = incoming;
          if (retained === null) return 'empty';
          const resolve = async () =>
            resolveAppointmentReminderTarget(
              retained,
              await port.loadAppointments(),
              clock(),
            );
          if (!(await resolve())) {
            retained = null;
            port.onUnavailable('stale');
            return 'stale';
          }
          if (!(await port.confirmNavigation())) {
            // A user's declined leave prompt cancels this tap, not their draft.
            retained = null;
            return 'declined';
          }
          // The leave prompt can remain open while a visit is edited or cancelled.
          const appointment = await resolve();
          if (!appointment) {
            retained = null;
            port.onUnavailable('stale');
            return 'stale';
          }
          if (!port.openVisitPreparation(appointment)) return 'deferred';
          retained = null;
          return 'opened';
        } catch {
          port.onUnavailable('error');
          return 'error';
        }
      },
    );
    queue = delivery.then(
      () => undefined,
      () => undefined,
    );
    return delivery;
  };
}
