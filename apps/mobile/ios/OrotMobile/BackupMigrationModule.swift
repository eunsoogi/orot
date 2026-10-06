import Foundation
import React
import Security

enum RecordingBackupEligibility {
    /// Only stable UUID-named files in the permanent recording directory belong in device backup.
    static func prepareDirectoryAndFiles(_ directory: URL) throws {
        try markEligible(directory)
        let recordings = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [],
        )
        for recording in recordings {
            let values = try recording.resourceValues(forKeys: [.isRegularFileKey])
            guard values.isRegularFile == true,
                  ["m4a", "caf"].contains(recording.pathExtension.lowercased()),
                  UUID(uuidString: recording.deletingPathExtension().lastPathComponent) != nil
            else {
                throw RecordingFileSecurityError.backupEligibilityNotApplied
            }
            try FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.complete],
                ofItemAtPath: recording.path,
            )
            try markEligible(recording)
            try verify(recording)
        }
        try verify(directory)
    }

    static func markEligible(_ url: URL) throws {
        var mutableURL = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = false
        try mutableURL.setResourceValues(values)
    }

    static func verify(_ url: URL) throws {
        let values = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
        guard values.isExcludedFromBackup == false else {
            throw RecordingFileSecurityError.backupEligibilityNotApplied
        }
    }
}

private struct DatabaseKeychainItem {
    let data: Data
    let accessibility: String
}

private enum BackupMigrationFailure: LocalizedError {
    case keychainRead(OSStatus)
    case keychainWrite(OSStatus)
    case invalidKeychainItem
    case unsupportedAccessibility
    case invalidDatabaseLocation

    var errorDescription: String? {
        switch self {
        case let .keychainRead(status):
            "The database key could not be read from Keychain (\(status))."
        case let .keychainWrite(status):
            "The database key accessibility could not be updated (\(status))."
        case .invalidKeychainItem:
            "The database key item could not be verified."
        case .unsupportedAccessibility:
            "The database key has an unsupported accessibility setting."
        case .invalidDatabaseLocation:
            "The encrypted database location could not be verified."
        }
    }
}

@objc(BackupMigrationModule)
public final class BackupMigrationModule: NSObject {
    private static let keychainService = "com.orot.mobile.database-encryption-key.v1"
    private static let keychainAccount = "database"
    private static let databaseName = "orot-secure.db"
    private static let oldAccessibility = kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String
    private static let backupAccessibility = kSecAttrAccessibleWhenUnlocked as String

    @objc public static func requiresMainQueueSetup() -> Bool {
        false
    }

    @objc(migrateDatabaseKeyForBackup:rejecter:)
    public func migrateDatabaseKeyForBackup(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        perform(resolve: resolve, reject: reject) {
            try Self.migrateDatabaseKey()
        }
    }

    @objc(isDatabaseKeyBackupEligible:rejecter:)
    public func isDatabaseKeyBackupEligible(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        perform(resolve: resolve, reject: reject) {
            guard let item = try Self.readDatabaseKey() else { return false }
            return Self.isValidKey(item.data) && item.accessibility == Self.backupAccessibility
        }
    }

    @objc(databaseFileState:location:resolver:rejecter:)
    public func databaseFileState(
        _ name: String,
        location: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        perform(resolve: resolve, reject: reject) {
            guard name == Self.databaseName, location.hasPrefix("/") else {
                throw BackupMigrationFailure.invalidDatabaseLocation
            }
            let folder = URL(fileURLWithPath: location, isDirectory: true).standardizedFileURL
            let database = folder.appendingPathComponent(name)
            let databaseExists = FileManager.default.fileExists(atPath: database.path)
            // Orphaned WAL/journal files can retain committed data and must not become a first-run database.
            let hasSidecars = !databaseExists && ["-wal", "-shm", "-journal"].contains {
                FileManager.default.fileExists(atPath: database.path + $0)
            }
            return databaseExists ? "present" : hasSidecars ? "partial" : "missing"
        }
    }

    @objc(prepareRecordingsForBackup:rejecter:)
    public func prepareRecordingsForBackup(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        perform(resolve: resolve, reject: reject) {
            try RecordingFileSecurity.prepareForDeviceBackup()
        }
    }

    private func perform(
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock,
        operation: @escaping () throws -> Any,
    ) {
        DispatchQueue.global(qos: .utility).async {
            do {
                try resolve(operation())
            } catch {
                reject("BACKUP_PREPARATION_FAILED", error.localizedDescription, error as NSError)
            }
        }
    }

    private static func migrateDatabaseKey() throws -> String {
        guard let previous = try readDatabaseKey() else { return "missing" }
        guard isValidKey(previous.data) else { throw BackupMigrationFailure.invalidKeychainItem }
        if previous.accessibility == backupAccessibility {
            return "alreadyEligible"
        }
        guard previous.accessibility == oldAccessibility else {
            throw BackupMigrationFailure.unsupportedAccessibility
        }

        // Update only the Keychain class so the existing database keeps its exact SQLCipher key bytes.
        let status = SecItemUpdate(
            keychainQuery() as CFDictionary,
            [
                kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked,
                kSecValueData as String: previous.data,
            ] as CFDictionary,
        )
        guard let updated = try readDatabaseKey(),
              updated.data == previous.data,
              updated.accessibility == backupAccessibility
        else {
            if let current = try readDatabaseKey(),
               current.data == previous.data,
               current.accessibility == oldAccessibility
            {
                throw BackupMigrationFailure.keychainWrite(status == errSecSuccess ? errSecDecode : status)
            }
            try restorePreviousKey(previous)
            throw BackupMigrationFailure.keychainWrite(status == errSecSuccess ? errSecDecode : status)
        }
        return "migrated"
    }

    private static func restorePreviousKey(_ item: DatabaseKeychainItem) throws {
        // If new eligibility cannot be read back, retain the prior key and device-only protection.
        var attributes = keychainQuery()
        attributes[kSecAttrAccessible as String] = item.accessibility as CFString
        attributes[kSecValueData as String] = item.data
        let addStatus = SecItemAdd(attributes as CFDictionary, nil)
        if addStatus != errSecSuccess, addStatus != errSecDuplicateItem {
            throw BackupMigrationFailure.keychainWrite(addStatus)
        }
        if addStatus == errSecDuplicateItem {
            let updateStatus = SecItemUpdate(
                keychainQuery() as CFDictionary,
                [
                    kSecAttrAccessible as String: item.accessibility as CFString,
                    kSecValueData as String: item.data,
                ] as CFDictionary,
            )
            guard updateStatus == errSecSuccess else {
                throw BackupMigrationFailure.keychainWrite(updateStatus)
            }
        }
        guard let restored = try readDatabaseKey(),
              restored.data == item.data,
              restored.accessibility == item.accessibility
        else {
            throw BackupMigrationFailure.invalidKeychainItem
        }
    }

    private static func readDatabaseKey() throws -> DatabaseKeychainItem? {
        var query = keychainQuery()
        query[kSecReturnData as String] = true
        query[kSecReturnAttributes as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else { throw BackupMigrationFailure.keychainRead(status) }
        guard let attributes = result as? [String: Any],
              let data = attributes[kSecValueData as String] as? Data,
              let accessibility = attributes[kSecAttrAccessible as String] as? String
        else {
            throw BackupMigrationFailure.invalidKeychainItem
        }
        return DatabaseKeychainItem(data: data, accessibility: accessibility)
    }

    private static func keychainQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecAttrSynchronizable as String: false,
        ]
    }

    private static func isValidKey(_ data: Data) -> Bool {
        guard let value = String(data: data, encoding: .utf8) else { return false }
        return value.range(of: "^[0-9a-fA-F]{64}$", options: .regularExpression) != nil
    }
}
