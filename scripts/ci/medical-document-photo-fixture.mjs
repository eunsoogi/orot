import { resolve } from 'node:path';
import { runIosSimulatorCommand, verifyIosTestSimulator } from './ios-test-simulator.mjs';

export const photoDocumentJourney =
  'OrotUITests/MedicalDocumentPhotoJourneyUITests/testSelectedPhotoSavesAndSurvivesRelaunch';

/** Seed only the owned test Simulator; the production picker still performs the actual selection. */
export function prepareMedicalDocumentPhoto(
  profile,
  owner,
  identifier,
  verify = verifyIosTestSimulator,
  run = runIosSimulatorCommand,
) {
  if (identifier !== photoDocumentJourney) return;
  if (verify(owner, profile).state !== 'Booted') {
    throw new Error('Photo fixture requires its booted owned destination');
  }
  run(['addmedia', owner.udid, resolve('scripts/ci/fixtures/synthetic-medical-document.png')]);
}
