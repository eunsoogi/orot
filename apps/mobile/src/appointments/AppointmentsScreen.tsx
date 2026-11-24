import { useNavigationEdgeVerticalScroll } from '../navigation/navigationEdgeScroll';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { Fragment, useEffect, useState } from 'react';
import { AppState, ScrollView, View } from 'react-native';
import type { Appointment, AppointmentRepository } from '@orot/storage';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { AppointmentListReadStatus } from './AppointmentListReadStatus';
import { t } from '../i18n';
import { VerticalPageSections as AdaptiveColumns } from '../layout/VerticalPageSections';
import { AppointmentListItem } from './AppointmentListItem';
import AppointmentCard from './AppointmentCard';
import AppointmentForm from './AppointmentForm';
import styles from './appointmentsStyles';
import { useAppointmentsScreenState } from './useAppointmentsScreenState';
import { useAppointmentAddAction } from './useAppointmentAddAction';
import { requestAppointmentCancellationConfirmation } from './appointmentActionConfirmation';
import {
  appointmentDisplayUntil,
  isEligibleNextVisit,
} from '../routes/nextAppointment';
interface AppointmentsScreenProps {
  active?: boolean;
  fullNavigationLane?: boolean;
  repository: AppointmentRepository;
  onAppointmentsChanged?: () => void;
}
/** Keeps explicit detail selection separate while defaulting to the eligible next visit. */
export default function AppointmentsScreen({
  active = true,
  fullNavigationLane = false,
  repository,
  onAppointmentsChanged,
}: AppointmentsScreenProps) {
  const inset = useNavigationContentInset();
  const edge = useNavigationEdgeVerticalScroll({
    ownerWidth: active && fullNavigationLane ? undefined : 0,
    trailingPadding: 20,
  });
  const content = [styles.container, inset, edge.contentStyle];
  const [now, setNow] = useState(Date.now);
  const state = useAppointmentsScreenState({
    active,
    now,
    repository,
    onAppointmentsChanged,
  });
  const { reload, selectedAppointment, selectedAppointmentId } = state;
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
        reload().catch(() => undefined);
      }
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [active, now, state.appointments, reload]);
  const upcomingAppointments = state.appointments.filter(appointment =>
    isEligibleNextVisit(appointment, now),
  );
  const historicalAppointments = state.appointments.filter(
    appointment => !isEligibleNextVisit(appointment, now),
  );
  const hasDock = useAppointmentAddAction(
    !state.formOpen,
    state.saving,
    state.startNewAppointment,
  );

  const renderAppointment = (appointment: Appointment, history: boolean) => {
    const selected = appointment.id === selectedAppointmentId;
    return (
      <Fragment key={appointment.id}>
        <AppointmentListItem
          appointment={appointment}
          history={history}
          nextVisit={!history && appointment.id === state.nextAppointment?.id}
          selected={selected}
          onSelect={() => state.setSelectedAppointmentId(appointment.id)}
        />
        {selected ? (
          <View testID="appointments-columns-secondary">
            <AppointmentCard
              appointment={appointment}
              onEdit={() => state.startEditing(appointment)}
              onCancel={() =>
                requestAppointmentCancellationConfirmation(appointment, () =>
                  state.cancelAppointment(appointment),
                )
              }
            />
          </View>
        ) : null}
      </Fragment>
    );
  };

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
      <AppointmentListReadStatus
        loading={state.loading}
        failed={state.readError}
        onRetry={reload}
      />
      {state.appointments.length === 0 ? (
        !state.loading && !state.readError ? (
          <Text testID="appointments-empty">{t('appointments.empty')}</Text>
        ) : null
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
              {upcomingAppointments.map(appointment =>
                renderAppointment(appointment, false),
              )}
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
              {historicalAppointments.map(appointment =>
                renderAppointment(appointment, true),
              )}
            </View>
          ) : null}
        </View>
      )}
      {!selectedAppointment ? (
        <Text
          style={styles.selectionPrompt}
          testID="appointments-selection-prompt"
        >
          {t('appointments.detail.selectPrompt')}
        </Text>
      ) : null}
      {!hasDock ? (
        <Button
          onPress={state.startNewAppointment}
          testID="appointment-add"
          title={t('appointments.actions.add')}
        />
      ) : null}
    </View>
  );

  return (
    <ScrollView
      // Starting an edit replaces the list and resets its potentially distant scroll offset.
      key={state.formOpen ? 'editor' : 'list'}
      contentContainerStyle={content}
      {...edge.indicatorProps}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      style={[styles.scroll, edge.scrollViewStyle]}
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
        testID="appointments-columns"
      />
    </ScrollView>
  );
}
