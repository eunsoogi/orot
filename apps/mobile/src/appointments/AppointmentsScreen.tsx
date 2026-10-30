import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { useEffect, useMemo, useState } from 'react';
import { AppState, ScrollView, View } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { VerticalPageSections as AdaptiveColumns } from '../layout/VerticalPageSections';
import { AppointmentListItem } from './AppointmentListItem';
import AppointmentCard from './AppointmentCard';
import AppointmentForm from './AppointmentForm';
import styles from './appointmentsStyles';
import { useAppointmentsScreenState } from './useAppointmentsScreenState';
import {
  appointmentDisplayUntil,
  isEligibleNextVisit,
  selectNextAppointment,
} from '../routes/nextAppointment';

interface AppointmentsScreenProps {
  active?: boolean;
  repository: AppointmentRepository;
  onAppointmentsChanged?: () => void;
}

/** Separates next-visit eligibility from detail selection while retaining each record's actions. */
export default function AppointmentsScreen({
  active = true,
  repository,
  onAppointmentsChanged,
}: AppointmentsScreenProps) {
  const navigationInset = useNavigationContentInset();
  const state = useAppointmentsScreenState({
    active,
    repository,
    onAppointmentsChanged,
  });
  const reloadAppointments = state.reload;
  const [now, setNow] = useState(Date.now);
  // Retained routes need a fresh eligibility snapshot when a visit reaches its exclusive end.
  useEffect(() => {
    if (active) setNow(Date.now());
  }, [active, state.appointments]);
  useEffect(() => {
    if (!active) return;
    const nextBoundary = Math.min(
      ...state.appointments
        .filter(appointment => isEligibleNextVisit(appointment, now))
        .map(appointmentDisplayUntil),
    );
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(1, Math.min(60_000, nextBoundary - now)),
    );
    const subscription = AppState.addEventListener('change', appState => {
      if (appState === 'active') {
        setNow(Date.now());
        reloadAppointments().catch(() => undefined);
      }
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [active, now, state.appointments, reloadAppointments]);
  const selectedAppointment = useMemo(
    () =>
      state.appointments.find(
        appointment => appointment.id === state.selectedAppointmentId,
      ) ?? null,
    [state.appointments, state.selectedAppointmentId],
  );
  const nextAppointment = useMemo(
    () => selectNextAppointment(state.appointments, now),
    [state.appointments, now],
  );
  const upcomingAppointments = state.appointments.filter(appointment =>
    isEligibleNextVisit(appointment, now),
  );
  const historicalAppointments = state.appointments.filter(
    appointment => !isEligibleNextVisit(appointment, now),
  );

  // The selected ID belongs to this screen so measured panel changes do not reset selection.
  const primaryPanel = state.formOpen ? (
    <AppointmentForm
      editing={Boolean(state.editing)}
      clinicLabel={state.clinicLabel}
      date={state.date}
      time={state.time}
      note={state.note}
      saving={state.saving}
      onClinicLabelChange={value => {
        state.setClinicLabel(value);
        state.setInputRevision(current => current + 1);
      }}
      onDateChange={value => {
        state.setDate(value);
        state.setInputRevision(current => current + 1);
      }}
      onTimeChange={value => {
        state.setTime(value);
        state.setInputRevision(current => current + 1);
      }}
      onNoteChange={value => {
        state.setNote(value);
        state.setInputRevision(current => current + 1);
      }}
      onSave={state.saveAppointment}
      onClose={() => {
        state.setFormOpen(false);
        state.setRevision(current => current + 1);
      }}
    />
  ) : (
    <View style={styles.panel}>
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="appointments-title"
      >
        {t('appointments.title')}
      </Text>
      <Text style={styles.message}>{t('appointments.description')}</Text>
      {state.loading ? (
        <Text testID="appointments-loading">{t('appointments.loading')}</Text>
      ) : state.error && state.appointments.length === 0 ? (
        <Button
          onPress={() => state.reload()}
          testID="appointments-retry"
          title={t('appointments.retry')}
        />
      ) : state.appointments.length === 0 ? (
        <Text testID="appointments-empty">{t('appointments.empty')}</Text>
      ) : (
        <View style={styles.list} testID="appointments-list">
          {upcomingAppointments.length > 0 ? (
            <View
              style={styles.listSection}
              testID="appointments-section-upcoming"
            >
              <Text accessibilityRole="header" style={styles.listSectionTitle}>
                {t('appointments.section.upcoming')}
              </Text>
              {upcomingAppointments.map(appointment => (
                <AppointmentListItem
                  key={appointment.id}
                  appointment={appointment}
                  history={false}
                  nextVisit={appointment.id === nextAppointment?.id}
                  selected={appointment.id === state.selectedAppointmentId}
                  onSelect={() =>
                    state.setSelectedAppointmentId(appointment.id)
                  }
                />
              ))}
            </View>
          ) : null}
          {historicalAppointments.length > 0 ? (
            <View
              style={styles.listSection}
              testID="appointments-section-history"
            >
              <Text accessibilityRole="header" style={styles.listSectionTitle}>
                {t('appointments.section.history')}
              </Text>
              {historicalAppointments.map(appointment => (
                <AppointmentListItem
                  key={appointment.id}
                  appointment={appointment}
                  history
                  nextVisit={false}
                  selected={appointment.id === state.selectedAppointmentId}
                  onSelect={() =>
                    state.setSelectedAppointmentId(appointment.id)
                  }
                />
              ))}
            </View>
          ) : null}
        </View>
      )}
      <Button
        onPress={state.startNewAppointment}
        testID="appointment-add"
        title={t('appointments.actions.add')}
      />
    </View>
  );

  const secondaryPanel = state.formOpen ? undefined : (
    <View style={styles.detailPanel}>
      <Text accessibilityRole="header" style={styles.detailTitle}>
        {t('appointments.detail.title')}
      </Text>
      {selectedAppointment ? (
        <AppointmentCard
          appointment={selectedAppointment}
          onEdit={() => state.startEditing(selectedAppointment)}
          onCancel={() => state.cancelAppointment(selectedAppointment)}
        />
      ) : (
        <Text
          style={styles.selectionPrompt}
          testID="appointments-selection-prompt"
        >
          {t('appointments.detail.selectPrompt')}
        </Text>
      )}
    </View>
  );

  return (
    <ScrollView
      // Starting an edit replaces the list and resets its potentially distant scroll offset.
      key={state.formOpen ? 'editor' : 'list'}
      contentContainerStyle={[styles.container, navigationInset]}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      style={styles.scroll}
      testID="appointments-scroll"
    >
      {state.notice ? (
        <Text accessibilityLiveRegion="polite">{state.notice}</Text>
      ) : null}
      {state.error ? (
        <Text
          accessibilityRole="alert"
          style={styles.error}
          testID="appointment-error"
        >
          {state.error}
        </Text>
      ) : null}
      <AdaptiveColumns
        primary={primaryPanel}
        routeKey="appointments"
        secondary={secondaryPanel}
        testID="appointments-columns"
      />
    </ScrollView>
  );
}
