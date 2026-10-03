import Foundation

public struct ChatGPTStoredAccount: Equatable, Sendable {
    public let issuedClientID: String
    public let hostIdentifier: String
    public let subject: String
    public let grantedScopes: Set<String>
    public let expiresAt: Date?
    let credentials: ChatGPTStoredCredentials?

    init(
        issuedClientID: String,
        hostIdentifier: String,
        subject: String,
        grantedScopes: Set<String>,
        expiresAt: Date?,
        credentials: ChatGPTStoredCredentials?
    ) {
        self.issuedClientID = issuedClientID
        self.hostIdentifier = hostIdentifier
        self.subject = subject
        self.grantedScopes = grantedScopes
        self.expiresAt = expiresAt
        self.credentials = credentials
    }

    public var requiresSignIn: Bool {
        credentials == nil
    }

    public var hasDirectPlanAccess: Bool {
        credentials != nil && grantedScopes.contains(ChatGPTOAuthConstants.directPlanScope)
    }

    func replacingCredentials(
        _ credentials: ChatGPTStoredCredentials?,
        scopes: Set<String>? = nil,
        expiresAt: Date?
    ) -> ChatGPTStoredAccount {
        return ChatGPTStoredAccount(
            issuedClientID: issuedClientID,
            hostIdentifier: hostIdentifier,
            subject: subject,
            grantedScopes: scopes ?? grantedScopes,
            expiresAt: expiresAt,
            credentials: credentials
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
        return ChatGPTStoredAccount(
            issuedClientID: "oaiapp_simulator_fixture_00000000000000000000000000000000",
            hostIdentifier: "urn:uuid:00000000-0000-4000-8000-000000000000",
            subject: "synthetic-account-subject",
            grantedScopes: ["openid", ChatGPTOAuthConstants.directPlanScope],
            expiresAt: Date(timeIntervalSince1970: 1_900_000_000),
            credentials: ChatGPTStoredCredentials(
                accessToken: "synthetic-access-token",
                refreshToken: "synthetic-refresh-token",
                idToken: "synthetic-id-token",
                tokenType: "Bearer"
            )
        )
    }
}
#endif
