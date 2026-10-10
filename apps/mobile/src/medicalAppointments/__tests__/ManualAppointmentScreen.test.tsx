import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import type { Appointment, AppointmentRepository } from '@orot/storage';
import ManualAppointmentScreen from '../ManualAppointmentScreen';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');

  return {
    SafeAreaProvider: ({
      children,
      style,
    }: {
      children?: ReactNode;
      style?: object;
    }) => React.createElement(View, { style }, children),
    SafeAreaView: ({
      children,
      style,
      testID,
    }: {
      children?: ReactNode;
      style?: object;
      testID?: string;
    }) => React.createElement(View, { style, testID }, children),
  };
});

const existing: Appointment = {
  id: 'manual-appointment-1',
  effectiveAt: '2035-06-02T00:00:00.000Z',
  recordedAt: '2035-01-01T00:00:00.000Z',
  ingestedAt: '2035-01-01T00:00:00.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  status: 'scheduled',
  clinicLabel: '수동 입력 일정',
  note: '기존 메모',
};

function repository(appointments: Appointment[] = []) {
  return {
    list: jest.fn(async () => appointments),
    create: jest.fn(async () => existing),
    confirmCalendarEvent: jest.fn(),
    reconfirmCalendarEvent: jest.fn(),
    update: jest.fn(async () => existing),
    cancel: jest.fn(async () => existing),
  } as unknown as AppointmentRepository;
}

describe('independent manual appointment page', () => {
  it('keeps Back in the shared bottom menu inside the route safe area', async () => {
    const onBack = jest.fn();
    await render(
      <ManualAppointmentScreen repository={repository()} onBack={onBack} />,
    );

    const toolbar = screen.getByTestId('navigation-bar-native-surface');
    expect(screen.getByTestId('safe-area-root')).toBeTruthy();
    expect(toolbar.props.actions).toEqual([
      expect.objectContaining({ id: 'back', testID: 'appointments-back' }),
    ]);
    expect(screen.queryByTestId('appointments-top-back')).toBeNull();
    await fireEvent.press(screen.getByTestId('appointments-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('creates a local appointment without Calendar or AI services', async () => {
    const appointments = repository();
    const onBack = jest.fn();
    await render(
      <ManualAppointmentScreen repository={appointments} onBack={onBack} />,
    );

    await fireEvent.press(screen.getByTestId('appointment-add'));
    await fireEvent.changeText(
      screen.getByTestId('appointment-clinic-input'),
      '수동 방문',
    );
    await fireEvent.changeText(
      screen.getByTestId('appointment-date-input'),
      '2035-06-02',
    );
    await fireEvent.changeText(
      screen.getByTestId('appointment-time-input'),
      '09:30',
    );
    await fireEvent.press(screen.getByTestId('appointment-save'));

    expect(appointments.create).toHaveBeenCalledWith(
      expect.objectContaining({ clinicLabel: '수동 방문' }),
    );
    expect(appointments.confirmCalendarEvent).not.toHaveBeenCalled();
  });

  it('edits an existing appointment through the same local repository', async () => {
    const appointments = repository([existing]);
    await render(
      <ManualAppointmentScreen repository={appointments} onBack={jest.fn()} />,
    );

    await fireEvent.press(
      screen.getByTestId('appointment-edit-manual-appointment-1'),
    );
    await fireEvent.changeText(
      screen.getByTestId('appointment-clinic-input'),
      '수정된 일정',
    );
    await fireEvent.press(screen.getByTestId('appointment-save'));

    expect(appointments.update).toHaveBeenCalledWith(
      'manual-appointment-1',
      expect.objectContaining({ clinicLabel: '수정된 일정' }),
    );
  });
});
