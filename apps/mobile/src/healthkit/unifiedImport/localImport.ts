import {
  openLocalAppointmentRepository,
  openLocalStorage,
} from '../../storage/secureDatabase';
import { eventKitCalendarBridge } from '../../calendar/calendarBridge';
import type { CalendarEvent } from '../../calendar/types';
import { healthKit } from '..';
import { healthKitFeatures } from '../types';
import { createUnifiedImportCoordinator } from './coordinator';
import { createUnifiedFeatureImporter } from './featureImporter';

const unifiedFeatureImporter = createUnifiedFeatureImporter({
  healthKit,
  now: () => new Date().toISOString(),
});

const calendarConfirmationQueues = new Map<string, Promise<void>>();

async function confirmCalendarEvent(event: CalendarEvent): Promise<void> {
  const key = calendarOccurrenceKey(event);
  const previous = calendarConfirmationQueues.get(key) ?? Promise.resolve();
  // A reopened run has a new run-local guard, so serialize its read-then-write by occurrence.
  const operation = previous
    .catch(() => undefined)
    .then(() => persistCalendarConfirmation(event));
  calendarConfirmationQueues.set(key, operation);
  try {
    await operation;
  } finally {
    if (calendarConfirmationQueues.get(key) === operation) {
      calendarConfirmationQueues.delete(key);
    }
  }
}

async function persistCalendarConfirmation(
  event: CalendarEvent,
): Promise<void> {
  const repository = await openLocalAppointmentRepository();
  const occurrence =
    event.calendarEventSnapshot.occurrenceDate ??
    event.calendarEventSnapshot.floatingOccurrenceAt ??
    event.effectiveAt;
  // Reconfirming the same recurrence occurrence must not create a duplicate appointment.
  const existing = (await repository.list()).find(appointment => {
    if (
      (appointment.status !== 'scheduled' &&
        appointment.status !== 'rescheduled') ||
      appointment.calendarEventIdentifier !== event.calendarEventIdentifier ||
      !appointment.calendarEventSnapshot
    ) {
      return false;
    }
    const savedOccurrence =
      appointment.calendarEventSnapshot.occurrenceDate ??
      appointment.calendarEventSnapshot.floatingOccurrenceAt ??
      appointment.effectiveAt;
    return savedOccurrence === occurrence;
  });
  if (existing) await repository.reconfirmCalendarEvent(existing.id, event);
  else await repository.confirmCalendarEvent(event);
}

function calendarOccurrenceKey(event: CalendarEvent): string {
  const occurrence =
    event.calendarEventSnapshot.occurrenceDate ??
    event.calendarEventSnapshot.floatingOccurrenceAt ??
    event.effectiveAt;
  // The key remains in memory and never enters the privacy-safe measurement stream.
  return JSON.stringify([event.calendarEventIdentifier, occurrence]);
}

/** One explicit action requests only selected providers; one confirmed event is stored at most. */
export const unifiedHealthImportCoordinator = createUnifiedImportCoordinator({
  healthKit: {
    requestReadAuthorizations: features =>
      healthKit.requestReadAuthorizations(features),
  },
  eventKit: eventKitCalendarBridge,
  openRepository: openLocalStorage,
  confirmCalendarEvent,
  runFeature: unifiedFeatureImporter,
});

export const unifiedHealthImportFeatures = healthKitFeatures;
