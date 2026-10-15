#if OROT_TESTS && targetEnvironment(simulator)
    import AVFoundation
    import CryptoKit
    import Foundation
    import Security
    import Speech

    /// Exact application-owned reset boundary, available only in test Simulator products before React starts.
    enum TestFixtureState {
        static let services = [
            "com.orot.mobile.database-encryption-key.v1", "com.orot.mobile.database-initialization.v1",
            "com.orot.mobile.provider-selection.v1", "com.orot.provider.openai.credentials",
            "com.orot.provider.openai.simulator-fixture",
        ]
        private static let manager = FileManager.default
        private static let bundle = "com.orot.mobile"
        private static let preferenceKeys = ["OrotFixturePollution", "com.orot.provider.openai.ext-agent-host-id"]

        private static var paths: [String: URL] {
            let library = manager.urls(for: .libraryDirectory, in: .userDomainMask)[0]
            let support = manager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            return [
                "database": library.appendingPathComponent("orot-secure.db"),
                "wal": library.appendingPathComponent("orot-secure.db-wal"),
                "shm": library.appendingPathComponent("orot-secure.db-shm"),
                "recordings": support.appendingPathComponent("Recordings"),
                "deletions": support.appendingPathComponent("RecordingDeletionStaging"),
                "exports": manager.temporaryDirectory.appendingPathComponent("OrotRecordingExports"),
            ]
        }

        private static func query(_ service: String) -> [String: Any] {
            [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        }

        private static func keyData(_ service: String) throws -> Data? {
            var request = query(service)
            request[kSecReturnData as String] = true
            request[kSecMatchLimit as String] = kSecMatchLimitOne
            var value: CFTypeRef?
            let status = SecItemCopyMatching(request as CFDictionary, &value)
            if status == errSecItemNotFound {
                return nil
            }
            guard status == errSecSuccess, let data = value as? Data else {
                throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
            }
            return data
        }

        private static func deleteKey(_ service: String) throws {
            let status = SecItemDelete(query(service) as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else {
                throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
            }
        }

        private static func seedKey(_ service: String, token: String) throws {
            try deleteKey(service)
            var request = query(service)
            request[kSecAttrAccount as String] = "synthetic-isolation"
            request[kSecValueData as String] = Data(token.utf8)
            request[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let status = SecItemAdd(request as CFDictionary, nil)
            guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
        }

        private static func foreignFile(_ token: String) -> URL {
            manager.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("OrotFixtureForeign-\(token)")
        }

        private static func validate(_ token: String) throws {
            guard Bundle.main.bundleIdentifier == bundle, UUID(uuidString: token) != nil else {
                throw NSError(domain: "OrotFixtureState", code: 1)
            }
        }

        private static var microphone: (undetermined: Bool, granted: Bool) {
            if #available(iOS 17.0, *) {
                let permission = AVAudioApplication.shared.recordPermission
                return (permission == .undetermined, permission == .granted)
            }
            let permission = AVAudioSession.sharedInstance().recordPermission
            return (permission == .undetermined, permission == .granted)
        }

        /// Readbacks expose presence and an irreversible key fingerprint, never credentials or user content.
        static func snapshot(_ token: String) throws -> [String: Any] {
            try validate(token)
            let keys = try Dictionary(uniqueKeysWithValues: services.map { try ($0, keyData($0) != nil) })
            let key = try keyData(services[0])
            let fingerprint = key.map { SHA256.hash(data: $0).map { String(format: "%02x", $0) }.joined() }
            return try [
                "paths": paths.mapValues { manager.fileExists(atPath: $0.path) }, "keys": keys,
                "keyFingerprint": fingerprint.map { $0 as Any } ?? NSNull(),
                "preferencesEmpty": (UserDefaults.standard.persistentDomain(forName: bundle) ?? [:]).isEmpty,
                "pollutedPreferencesAbsent": preferenceKeys.allSatisfy { UserDefaults.standard.object(forKey: $0) == nil },
                "microphoneUndetermined": microphone.undetermined,
                "microphoneGranted": microphone.granted,
                "speechUndetermined": SFSpeechRecognizer.authorizationStatus() == .notDetermined,
                "speechGranted": SFSpeechRecognizer.authorizationStatus() == .authorized,
                "foreignFile": (try? Data(contentsOf: foreignFile(token))) == Data(token.utf8),
                "foreignKey": keyData("com.orot.tests.foreign.\(token)") == Data(token.utf8),
            ]
        }

        /// The host has terminated the prior process; no open SQL handle or in-memory authorization survives this command.
        static func reset(_ token: String) throws {
            try validate(token)
            for url in paths.values where manager.fileExists(atPath: url.path) {
                try manager.removeItem(at: url)
            }
            for service in services {
                try deleteKey(service)
            }
            // Materialize the existing domain and publish individual deletions before removing it.
            // A cold-process domain removal alone was observed empty locally but retained old values in the next XCTest host.
            for key in (UserDefaults.standard.persistentDomain(forName: bundle) ?? [:]).keys {
                UserDefaults.standard.removeObject(forKey: key)
            }
            UserDefaults.standard.removePersistentDomain(forName: bundle)
            guard UserDefaults.standard.synchronize() else { throw NSError(domain: "OrotFixtureState", code: 3) }
        }

        /// The preceding integration process created a real encrypted row and key. Seed every remaining owned category plus foreign sentinels.
        static func seedPollution(_ token: String) throws {
            try validate(token)
            guard manager.fileExists(atPath: paths["database"]!.path), try keyData(services[0]) != nil,
                  try keyData(services[1]) != nil else { throw NSError(domain: "OrotFixtureState", code: 2) }
            for name in ["recordings", "deletions", "exports"] {
                let directory = paths[name]!
                try manager.createDirectory(at: directory, withIntermediateDirectories: true)
                try Data(token.utf8).write(to: directory.appendingPathComponent("synthetic-contamination"), options: .atomic)
            }
            // A closed database may checkpoint away its sidecars; explicit residue still must be removed before the next open.
            for name in ["wal", "shm"] where !manager.fileExists(atPath: paths[name]!.path) {
                try Data(token.utf8).write(to: paths[name]!, options: .atomic)
            }
            for service in services.dropFirst(2) {
                try seedKey(service, token: token)
            }
            for key in preferenceKeys {
                UserDefaults.standard.set(token, forKey: key)
            }
            UserDefaults.standard.synchronize()
            try Data(token.utf8).write(to: foreignFile(token), options: .atomic)
            try seedKey("com.orot.tests.foreign.\(token)", token: token)
        }

        /// Only the regression test owns these UUID sentinels; ordinary fixture reset never touches them.
        static func removeSentinels(_ token: String) throws {
            try validate(token)
            if manager.fileExists(atPath: foreignFile(token).path) {
                try manager.removeItem(at: foreignFile(token))
            }
            try deleteKey("com.orot.tests.foreign.\(token)")
        }
    }
#endif
