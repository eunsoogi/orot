import {
  toAppointmentTimestamp,
  toLocalAppointmentDateTime,
} from '../src/appointments/dateTime';

describe('appointment local date and time conversion', () => {
  it('round-trips the selected local appointment time through its stored instant', () => {
    const timestamp = toAppointmentTimestamp('2027-06-01', '09:45');

    expect(timestamp).not.toBeNull();
    expect(toLocalAppointmentDateTime(timestamp!)).toEqual({
      date: '2027-06-01',
      time: '09:45',
    });
  });

  it('rejects invalid dates, times, and non-existent local daylight-saving times', () => {
    expect(toAppointmentTimestamp('2027-02-29', '09:00')).toBeNull();
    expect(toAppointmentTimestamp('2027-03-01', '24:00')).toBeNull();
    expect(toAppointmentTimestamp('2027-03-14', '02:30', 'America/New_York')).toBeNull();
    expect(
      toLocalAppointmentDateTime('2027-03-14T06:30:00Z', 'America/New_York'),
    ).toEqual({ date: '2027-03-14', time: '01:30' });
  });
});
