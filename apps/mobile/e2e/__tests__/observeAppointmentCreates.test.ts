import type { AppointmentRepository } from '@orot/storage';
import { observeAppointmentCreates } from '../observeAppointmentCreates';

test('observes the identity returned by each successful create without replacing the repository', async () => {
  const first = { id: 'appointment-generated-first' };
  const second = { id: 'appointment-generated-second' };
  const create = jest
    .fn()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second)
    .mockRejectedValueOnce(new Error('save failed'));
  const list = jest.fn().mockResolvedValue([first, second]);
  const repository = { create, list } as unknown as AppointmentRepository;
  const observe = jest.fn();
  const observed = observeAppointmentCreates(repository, observe);
  const input = {
    clinicLabel: 'Synthetic',
    effectiveAt: '2027-06-03T10:15:00Z',
  };

  await expect(observed.create(input)).resolves.toBe(first);
  await expect(observed.create(input)).resolves.toBe(second);
  await expect(observed.create(input)).rejects.toThrow('save failed');
  await expect(observed.list()).resolves.toEqual([first, second]);
  expect(observe.mock.calls).toEqual([[first.id], [second.id]]);
  expect(create).toHaveBeenCalledWith(input);
});
