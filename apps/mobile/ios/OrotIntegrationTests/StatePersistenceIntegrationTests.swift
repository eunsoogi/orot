import Foundation
import LocalAuthentication
@testable import Orot
import Security
import XCTest

/// Three host invocations retain one real database and prove new process identities without accessibility sessions.
final class StatePersistenceIntegrationTests: OrotFailFastTestCase {
    func testFreshEncryptedStorageMemoryAndCheckpoint() async throws {
        let fixture = try fixtureIdentifier()
        let storage = try await operation("storage-create", parameters: ["storageIdentifier": fixture.replacingOccurrences(of: "test-persistence-", with: "test-storage-")])
        truths(storage, ["encrypted", "wrongKeyRejected", "recordsVerified"])
        let memory = try await operation("memory-create", parameters: ["fixtureIdentifier": memoryIdentifier()])
        truths(memory, ["persisted", "networkDisabled"])
        let checkpoint = try await operation("checkpoint-persistence", parameters: ["fixtureIdentifier": fixture, "mode": "save"])
        XCTAssertEqual(checkpoint["value"] as? Int, 4)
        XCTAssertEqual(checkpoint["nodeRuns"] as? [String], ["increment"])
        XCTAssertEqual(checkpoint["note"] as? String, "환자 기록: café 🌱🩺")
        try attach(fixture, phase: "seed")
    }

    func testStorageReadMemoryDeletionAndCheckpointResumeInNewProcess() async throws {
        let fixture = try fixtureIdentifier()
        try requireNewProcess()
        let storage = try await operation("storage-read", parameters: ["storageIdentifier": fixture.replacingOccurrences(of: "test-persistence-", with: "test-storage-")])
        truths(storage, ["sourceAndEvidenceRestored", "ragChunksVerified"])
        let memory = try await operation("memory-restart", parameters: ["fixtureIdentifier": memoryIdentifier()])
        truths(memory, ["restoredBeforeDeletion", "removed", "networkDisabled"])
        let checkpoint = try await operation("checkpoint-persistence", parameters: ["fixtureIdentifier": fixture, "mode": "resume"])
        XCTAssertEqual(checkpoint["value"] as? Int, 8)
        XCTAssertEqual(checkpoint["nodeRuns"] as? [String], ["increment", "double"])
        XCTAssertEqual(checkpoint["note"] as? String, "환자 기록: café 🌱🩺")
        XCTAssertEqual(checkpoint["cleaned"] as? Bool, true)
        try attach(fixture, phase: "resume")
    }

    func testRemovedMemoryAndSearchStayAbsentInThirdProcess() async throws {
        let fixture = try fixtureIdentifier()
        try requireNewProcess()
        let result = try await operation("memory-verify-deletion", parameters: ["fixtureIdentifier": memoryIdentifier()])
        truths(result, ["absentFromMemoryAndSearch", "networkDisabled"])
        try attach(fixture, phase: "absence")
    }

    /// Exercises protected Keychain access with synthetic credentials and without prompting for user data.
    func testProtectedKeychainQueryAcceptsCredentialRejectsWrongCredentialAndDisallowsUi() {
        let service = "com.orot.tests.keychain-auth.\(UUID().uuidString)"
        let account = "protected-fixture"
        let expectedData = Data("synthetic-keychain-value".utf8)
        let acceptedPassword = Data("synthetic-password".utf8)
        var creationError: Unmanaged<CFError>?
        guard let accessControl = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            .applicationPassword,
            &creationError,
        ) else {
            let details = creationError.map { CFErrorCopyDescription($0.takeRetainedValue()) as String }
                ?? "No error details were returned"
            XCTFail("Could not create the synthetic access-control fixture: \(details)")
            return
        }

        // The unique item is app-password protected so Security itself evaluates the production LAContext.
        let keyClass = kSecClass as String
        let serviceKey = kSecAttrService as String
        let accountKey = kSecAttrAccount as String
        let accessControlKey = kSecAttrAccessControl as String
        let contextKey = kSecUseAuthenticationContext as String
        let deleteQuery = NSMutableDictionary(dictionary: [
            keyClass: kSecClassGenericPassword,
            serviceKey: service,
            accountKey: account,
        ])
        defer {
            RNKeychainSetAuthenticationPrompt(deleteQuery, "Delete a synthetic protected fixture")
            guard let deleteContext = deleteQuery[contextKey] as? LAContext,
                  deleteContext.setCredential(acceptedPassword, type: .applicationPassword)
            else {
                XCTFail("The RNKeychain helper must provide a noninteractive cleanup context")
                return
            }
            deleteContext.interactionNotAllowed = true
            let deleteStatus = SecItemDelete(deleteQuery as CFDictionary)
            XCTAssertTrue(
                deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound,
                "The synthetic protected item must be removed after the test",
            )
        }

        let addQuery = NSMutableDictionary(dictionary: [
            keyClass: kSecClassGenericPassword,
            serviceKey: service,
            accountKey: account,
            accessControlKey: accessControl,
            kSecValueData as String: expectedData,
        ])
        RNKeychainSetAuthenticationPrompt(addQuery, "Create a synthetic protected fixture")
        guard let addContext = addQuery[contextKey] as? LAContext,
              addContext.setCredential(acceptedPassword, type: .applicationPassword)
        else {
            XCTFail("The RNKeychain helper must provide a credential-ready context for creation")
            return
        }
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        XCTAssertEqual(addStatus, errSecSuccess, "The simulator must store the protected synthetic item")
        guard addStatus == errSecSuccess else { return }

        let queryBase: [String: Any] = [
            keyClass: kSecClassGenericPassword,
            serviceKey: service,
            accountKey: account,
            kSecReturnData as String: true,
        ]

        let allowedQuery = NSMutableDictionary(dictionary: queryBase)
        RNKeychainSetAuthenticationPrompt(allowedQuery, "Read a synthetic protected fixture")
        guard let allowedContext = allowedQuery[contextKey] as? LAContext,
              allowedContext.setCredential(acceptedPassword, type: .applicationPassword)
        else {
            XCTFail("The RNKeychain helper must provide a fresh context for an allowed read")
            return
        }
        var allowedResult: CFTypeRef?
        let allowedStatus = SecItemCopyMatching(allowedQuery as CFDictionary, &allowedResult)
        XCTAssertEqual(allowedStatus, errSecSuccess, "A matching application credential must read the item")
        XCTAssertEqual(allowedResult as? Data, expectedData)

        let deniedQuery = NSMutableDictionary(dictionary: queryBase)
        RNKeychainSetAuthenticationPrompt(deniedQuery, "Reject a synthetic protected fixture")
        guard let deniedContext = deniedQuery[contextKey] as? LAContext,
              deniedContext.setCredential(Data("incorrect-password".utf8), type: .applicationPassword)
        else {
            XCTFail("The RNKeychain helper must provide a fresh context for a denied read")
            return
        }
        deniedContext.interactionNotAllowed = true
        var deniedResult: CFTypeRef?
        let deniedStatus = SecItemCopyMatching(deniedQuery as CFDictionary, &deniedResult)
        XCTAssertEqual(deniedStatus, errSecAuthFailed, "A wrong credential must be denied without prompting")
        XCTAssertNil(deniedResult)

        let noUiQuery = NSMutableDictionary(dictionary: queryBase)
        RNKeychainDisallowAuthenticationUI(noUiQuery)
        guard let noUiContext = noUiQuery[contextKey] as? LAContext, noUiContext.interactionNotAllowed else {
            XCTFail("The RNKeychain no-UI helper must provide a noninteractive context")
            return
        }
        var noUiResult: CFTypeRef?
        let noUiStatus = SecItemCopyMatching(noUiQuery as CFDictionary, &noUiResult)
        XCTAssertEqual(noUiStatus, errSecInteractionNotAllowed, "A protected lookup must remain noninteractive")
        XCTAssertNil(noUiResult)
    }

    private func fixtureIdentifier() throws -> String {
        let fixture = try XCTUnwrap(ProcessInfo.processInfo.environment["OROT_STATE_FIXTURE"])
        XCTAssertTrue(fixture.hasPrefix("test-persistence-"))
        XCTAssertNotNil(UUID(uuidString: String(fixture.dropFirst("test-persistence-".count))))
        return fixture
    }

    private func requireNewProcess() throws {
        let text = try XCTUnwrap(ProcessInfo.processInfo.environment["OROT_STATE_PREVIOUS_PIDS"])
        let previous = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [Int])
        XCTAssertFalse(previous.isEmpty)
        XCTAssertFalse(previous.contains(Int(ProcessInfo.processInfo.processIdentifier)))
    }

    private func memoryIdentifier() throws -> String {
        // Storage and memory probes hash UUID bytes; separate UUIDs prevent accidental source deduplication across domains.
        let identifier = try XCTUnwrap(ProcessInfo.processInfo.environment["OROT_STATE_MEMORY_FIXTURE"])
        XCTAssertTrue(identifier.hasPrefix("test-memory-"))
        let uuid = try XCTUnwrap(UUID(uuidString: String(identifier.dropFirst("test-memory-".count))))
        XCTAssertNotEqual(uuid, try UUID(uuidString: String(fixtureIdentifier().dropFirst("test-persistence-".count))))
        return identifier
    }

    private func operation(_ name: String, parameters: [String: Any]) async throws -> [String: Any] {
        // Preserve the operation and assertions while awaiting the real response, independent of host speed.
        let result = try await TestOperationBroker.shared.request(name, parameters: parameters)
        XCTAssertEqual(result["platform"] as? String, "ios")
        XCTAssertEqual(result["runtime"] as? String, "Hermes")
        return result
    }

    private func truths(_ result: [String: Any], _ fields: [String]) {
        for field in fields {
            XCTAssertEqual(result[field] as? Bool, true, field)
        }
    }

    private func attach(_ fixture: String, phase: String) throws {
        let receipt: [String: Any] = try ["fixtureIdentifier": fixture, "memoryIdentifier": memoryIdentifier(), "phase": phase,
                                          "processIdentifier": ProcessInfo.processInfo.processIdentifier]
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: receipt), uniformTypeIdentifier: "public.json")
        attachment.name = "state-persistence-\(phase)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
