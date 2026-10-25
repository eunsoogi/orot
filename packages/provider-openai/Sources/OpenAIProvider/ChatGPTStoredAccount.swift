import Foundation

/// A credential-free projection safe to return across the native bridge.
public struct ChatGPTAccountSummary: Codable, Equatable, Sendable {
    public let issuedClientID: String
    public let requiresSignIn: Bool
    public let hasDirectPlanAccess: Bool

    init(account: ChatGPTStoredAccount) {
        issuedClientID = account.issuedClientID
        let expiredWithoutRefresh = account.expiresAt.map { $0 <= Date() } == true
            && account.credentials?.refreshToken == nil
        requiresSignIn = account.requiresSignIn || expiredWithoutRefresh
        hasDirectPlanAccess = account.hasDirectPlanAccess
    }
}

public struct ChatGPTStoredAccount: Equatable, Sendable {
    public let issuedClientID: String
    public let hostIdentifier: String
    public let subject: String
    public let grantedScopes: Set<String>
    public let expiresAt: Date?
    let credentials: ChatGPTStoredCredentials?

    public var requiresSignIn: Bool {
        credentials == nil
    }

    public var hasDirectPlanAccess: Bool {
        credentials != nil && grantedScopes.contains(ChatGPTOAuthConstants.directPlanScope)
    }

    func replacingCredentials(
        _ credentials: ChatGPTStoredCredentials?,
        scopes: Set<String>? = nil,
        expiresAt: Date?,
    ) -> ChatGPTStoredAccount {
        ChatGPTStoredAccount(
            issuedClientID: issuedClientID,
            hostIdentifier: hostIdentifier,
            subject: subject,
            grantedScopes: scopes ?? grantedScopes,
            expiresAt: expiresAt,
            credentials: credentials,
        )
    }
}

extension ChatGPTStoredAccount: Codable {}

struct ChatGPTStoredCredentials: Codable, Equatable, Sendable {
    let accessToken: String
    let refreshToken: String?
    let idToken: String
    let tokenType: String
}

public protocol ChatGPTCredentialStore: Sendable {
    func loadOrCreateHostIdentifier() throws -> String
    func loadAccount(issuedClientID: String) throws -> ChatGPTStoredAccount?
    func listAccounts() throws -> [ChatGPTStoredAccount]
    func saveAccount(_ account: ChatGPTStoredAccount) throws
    func clearCredentials(issuedClientID: String) throws
    func removeAccount(issuedClientID: String) throws
}

public enum ChatGPTSignOutResult: Equatable, Sendable {
    case revoked
    case localCredentialsCleared
}

#if DEBUG
    public extension ChatGPTStoredAccount {
        static func syntheticKeychainFixture() -> ChatGPTStoredAccount {
            ChatGPTStoredAccount(
                issuedClientID: "oaiapp_simulator_fixture_00000000000000000000000000000000",
                hostIdentifier: "urn:uuid:00000000-0000-4000-8000-000000000000",
                subject: "synthetic-account-subject",
                grantedScopes: ["openid", ChatGPTOAuthConstants.directPlanScope],
                expiresAt: Date(timeIntervalSince1970: 1_900_000_000),
                credentials: ChatGPTStoredCredentials(
                    accessToken: "synthetic-access-token",
                    refreshToken: "synthetic-refresh-token",
                    idToken: "synthetic-id-token",
                    tokenType: "Bearer",
                ),
            )
        }
    }
#endif
