#if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
    import Foundation
    import React

    extension RecordingFileSecurity {
        /// Exercises the dedicated probe's fail-closed paths without exposing file paths or bytes.
        static func simulatorExportAuthorizationReport(id: String) throws -> [String: Bool] {
            guard let fixtureBytes = RecordingSimulatorFixtureIntegrity.expectedBytes(for: id) else {
                throw RecordingFileSecurityError.recordingNotFound
            }

            let registeredFixtureAllowed: Bool
            do {
                _ = try simulatorProbeAudioExportSourceURL(id: id)
                registeredFixtureAllowed = try isSyntheticTranscriptionFixtureUnchanged(id: id)
            } catch {
                registeredFixtureAllowed = false
            }

            let missingIDRejected: Bool
            do {
                _ = try simulatorProbeAudioExportSourceURL(id: UUID().uuidString.lowercased())
                missingIDRejected = false
            } catch RecordingFileSecurityError.recordingNotFound,
                RecordingFileSecurityError.protectionNotApplied,
                RecordingFileSecurityError.backupExclusionNotApplied
            {
                missingIDRejected = true
            } catch {
                missingIDRejected = false
            }

            let unregisteredID = UUID().uuidString.lowercased()
            let unregisteredURL = try fileURL(
                id: unregisteredID,
                extension: "m4a",
                allowUnverifiedProtectionForSimulator: true,
            )
            defer { try? FileManager.default.removeItem(at: unregisteredURL) }
            try fixtureBytes.write(to: unregisteredURL, options: [.atomic])
            _ = try protect(unregisteredURL, allowUnverifiedProtectionForSimulator: true)
            try makeProtectionMetadataUnacceptable(for: unregisteredURL)
            let unregisteredFileUsesStrictPath = strictFallbackIsEnforced(for: unregisteredID)

            let fixtureURL = try existingFileURL(
                id: id,
                allowUnverifiedProtectionForSimulator: true,
            )
            try makeProtectionMetadataUnacceptable(for: fixtureURL)
            defer { _ = try? protect(fixtureURL, allowUnverifiedProtectionForSimulator: true) }
            RecordingSimulatorFixtureIntegrity.discard(id: id)
            defer { RecordingSimulatorFixtureIntegrity.register(id: id, bytes: fixtureBytes) }
            let discardedRegistrationUsesStrictPath = strictFallbackIsEnforced(for: id)

            return [
                "registeredFixtureAllowed": registeredFixtureAllowed,
                "missingIDRejected": missingIDRejected,
                "unregisteredFileUsesStrictPath": unregisteredFileUsesStrictPath,
                "discardedRegistrationUsesStrictPath": discardedRegistrationUsesStrictPath,
                "backupExclusionStillRequired": backupExclusionIsMandatory(),
            ]
        }

        /// Creates an explicit strict-path rejection condition in the isolated fixture test.
        private static func makeProtectionMetadataUnacceptable(for url: URL) throws {
            try FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.none],
                ofItemAtPath: url.path,
            )
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            guard (attributes[.protectionKey] as? FileProtectionType) != .complete else {
                throw RecordingFileSecurityError.protectionNotApplied
            }
        }

        private static func strictFallbackIsEnforced(for id: String) -> Bool {
            let probeURL: URL
            do {
                probeURL = try simulatorProbeAudioExportSourceURL(id: id)
            } catch RecordingFileSecurityError.protectionNotApplied,
                RecordingFileSecurityError.backupExclusionNotApplied
            {
                return true
            } catch {
                return false
            }

            do {
                let strictURL = try existingFileURL(id: id)
                return probeURL.standardizedFileURL == strictURL.standardizedFileURL
            } catch {
                // A probe URL that fails strict verification indicates an authorization bypass.
                return false
            }
        }

        private static func backupExclusionIsMandatory() -> Bool {
            let id = UUID().uuidString.lowercased()
            guard let url = try? fileURL(
                id: id,
                extension: "m4a",
                allowUnverifiedProtectionForSimulator: true,
            ) else {
                return false
            }
            defer { try? FileManager.default.removeItem(at: url) }

            do {
                try Data("synthetic backup guard probe".utf8).write(to: url, options: [.atomic])
                var mutableURL = url
                var values = URLResourceValues()
                values.isExcludedFromBackup = false
                try mutableURL.setResourceValues(values)
                _ = try existingFileURL(id: id, allowUnverifiedProtectionForSimulator: true)
                return false
            } catch RecordingFileSecurityError.backupExclusionNotApplied {
                return true
            } catch {
                return false
            }
        }
    }

    public extension RecordingModule {
        @objc(verifySyntheticRecordingExportAuthorization:resolver:rejecter:)
        func verifySyntheticRecordingExportAuthorization(
            _ recordingID: String,
            resolver resolve: @escaping RCTPromiseResolveBlock,
            rejecter reject: @escaping RCTPromiseRejectBlock,
        ) {
            workQueue.async {
                do {
                    let report = try RecordingFileSecurity.simulatorExportAuthorizationReport(id: recordingID)
                    resolve(report as NSDictionary)
                } catch {
                    reject("RECORDING_EXPORT_PROBE_FAILED", "Synthetic export authorization could not be checked.", nil)
                }
            }
        }
    }
#endif
