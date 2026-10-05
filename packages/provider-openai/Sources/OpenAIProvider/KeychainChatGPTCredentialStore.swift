import Foundation
import Security

public final class KeychainChatGPTCredentialStore: ChatGPTCredentialStore, @unchecked Sendable {
    private static let hostIdentifierAccount = "host-identifier"

    private let service: String
    private let lock = NSLock()
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(service: String = "com.orot.provider.openai.credentials") {
        self.service = service
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .secondsSince1970
        self.encoder = encoder

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        self.decoder = decoder
    }

    public func loadOrCreateHostIdentifier() throws -> String {
        lock.lock()
        defer { lock.unlock() }

        if let data = try readData(account: Self.hostIdentifierAccount),
           let identifier = String(data: data, encoding: .utf8),
           UserDefaultsHostIdentifierStore.isValidHostIdentifier(identifier)
        {
            return identifier
        }

        let identifier = "urn:uuid:\(UUID().uuidString.lowercased())"
        try writeData(Data(identifier.utf8), account: Self.hostIdentifierAccount)
        return identifier
    }

    public func loadAccount(issuedClientID: String) throws -> ChatGPTStoredAccount? {
        guard Self.isValidIssuedClientID(issuedClientID) else {
            throw ChatGPTOAuthError.invalidIdentity
        }

        lock.lock()
        defer { lock.unlock() }
        return try loadAccountLocked(issuedClientID: issuedClientID)
    }

    public func listAccounts() throws -> [ChatGPTStoredAccount] {
        lock.lock()
        defer { lock.unlock() }

        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll,
        ]
        query.removeValue(forKey: kSecAttrAccount as String)

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return []
        }
        guard status == errSecSuccess else {
            throw ChatGPTOAuthError.credentialStoreUnavailable
        }

        let entries: [[String: Any]]
        if let allEntries = result as? [[String: Any]] {
            entries = allEntries
        } else if let oneEntry = result as? [String: Any] {
            entries = [oneEntry]
        } else {
            throw ChatGPTOAuthError.credentialStoreUnavailable
        }

        let issuedClientIDs = try entries.compactMap { entry -> String? in
            guard let accountKey = entry[kSecAttrAccount as String] as? String,
                  accountKey.hasPrefix("issued-client:")
            else {
                return nil
            }
            let issuedClientID = String(accountKey.dropFirst("issued-client:".count))
            guard Self.isValidIssuedClientID(issuedClientID) else {
                throw ChatGPTOAuthError.credentialStoreUnavailable
            }
            return issuedClientID
        }

        // Resolve each identifier through the same validation path as single-account reads.
        return try issuedClientIDs.sorted().compactMap { issuedClientID in
            try loadAccountLocked(issuedClientID: issuedClientID)
        }
    }

    private func loadAccountLocked(issuedClientID: String) throws -> ChatGPTStoredAccount? {
        guard let data = try readData(account: Self.accountKey(issuedClientID)) else { return nil }
        guard let account = try? decoder.decode(ChatGPTStoredAccount.self, from: data),
              account.issuedClientID == issuedClientID,
              UserDefaultsHostIdentifierStore.isValidHostIdentifier(account.hostIdentifier),
              !account.subject.isEmpty,
              account.credentials.map(Self.hasValidCredentials) ?? true
        else {
            throw ChatGPTOAuthError.credentialStoreUnavailable
        }
        return account
    }

    public func saveAccount(_ account: ChatGPTStoredAccount) throws {
        guard Self.isValidIssuedClientID(account.issuedClientID),
              UserDefaultsHostIdentifierStore.isValidHostIdentifier(account.hostIdentifier),
              !account.subject.isEmpty,
              account.credentials.map(Self.hasValidCredentials) ?? true
        else {
            throw ChatGPTOAuthError.invalidIdentity
        }

        lock.lock()
        defer { lock.unlock() }
        let data: Data
        do {
            data = try encoder.encode(account)
        } catch {
            throw ChatGPTOAuthError.credentialStoreUnavailable
        }
        try writeData(data, account: Self.accountKey(account.issuedClientID))
    }

    public func clearCredentials(issuedClientID: String) throws {
        guard Self.isValidIssuedClientID(issuedClientID) else {
            throw ChatGPTOAuthError.invalidIdentity
        }

        lock.lock()
        defer { lock.unlock() }
        let key = Self.accountKey(issuedClientID)
        guard let data = try readData(account: key) else { return }
        guard let account = try? decoder.decode(ChatGPTStoredAccount.self, from: data) else {
            throw ChatGPTOAuthError.credentialStoreUnavailable
        }
        let signedOut = account.replacingCredentials(nil, expiresAt: nil)
        let replacement: Data
        do {
            replacement = try encoder.encode(signedOut)
        } catch {
            throw ChatGPTOAuthError.credentialStoreUnavailable
        }
        try writeData(replacement, account: key)
    }

    public func removeAccount(issuedClientID: String) throws {
        guard Self.isValidIssuedClientID(issuedClientID) else {
            throw ChatGPTOAuthError.invalidIdentity
        }

        lock.lock()
        defer { lock.unlock() }
        let status = SecItemDelete(baseQuery(account: Self.accountKey(issuedClientID)) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw ChatGPTOAuthError.credentialStoreUnavailable
        }
    }

    private func readData(account: String) throws -> Data? {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess, let data = result as? Data else {
            throw ChatGPTOAuthError.credentialStoreUnavailable
        }
        return data
    }

    private func writeData(_ data: Data, account: String) throws {
        let query = baseQuery(account: account)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }
        guard updateStatus == errSecItemNotFound else {
            throw ChatGPTOAuthError.credentialStoreUnavailable
        }

        var item = query
        attributes.forEach { item[$0.key] = $0.value }
        let addStatus = SecItemAdd(item as CFDictionary, nil)
        if addStatus == errSecSuccess {
            return
        }
        if addStatus == errSecDuplicateItem,
           SecItemUpdate(query as CFDictionary, attributes as CFDictionary) == errSecSuccess
        {
            return
        }
        throw ChatGPTOAuthError.credentialStoreUnavailable
    }

    private func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private static func accountKey(_ issuedClientID: String) -> String {
        "issued-client:\(issuedClientID)"
    }

    static func isValidIssuedClientID(_ value: String) -> Bool {
        guard value != ChatGPTOAuthConstants.initialClientID,
              !value.isEmpty,
              value.utf8.count <= 256
        else {
            return false
        }
        return value.unicodeScalars.allSatisfy {
            CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-").contains($0)
        }
    }

    private static func hasValidCredentials(_ credentials: ChatGPTStoredCredentials) -> Bool {
        !credentials.accessToken.isEmpty
            && !credentials.idToken.isEmpty
            && credentials.refreshToken.map { !$0.isEmpty } ?? true
            && credentials.tokenType.caseInsensitiveCompare("Bearer") == .orderedSame
    }
}
