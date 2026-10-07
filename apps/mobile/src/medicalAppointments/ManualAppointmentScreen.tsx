import type { AppointmentRepository } from '@orot/storage';
import AppointmentsScreen from '../appointments/AppointmentsScreen';

interface ManualAppointmentScreenProps {
  readonly repository: AppointmentRepository;
  readonly onBack: () => void;
}

/** Reuses #21's local appointment repository for a path independent of Calendar and AI. */
export default function ManualAppointmentScreen({
  repository,
  onBack,
}: ManualAppointmentScreenProps) {
  return <AppointmentsScreen repository={repository} onBack={onBack} />;
}
