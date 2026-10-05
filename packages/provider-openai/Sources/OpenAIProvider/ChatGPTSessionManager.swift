import Foundation

public actor ChatGPTSessionManager {
    let transport: any OAuthHTTPTransport
    let credentialStore: any ChatGPTCredentialStore
    let refreshLeeway: TimeInterval
    let now: @Sendable () -> Date
    var refreshTasks: [String: Task<ChatGPTStoredAccount, Error>] = [:]
    var signingOut = Set<String>()

    public init(
        session: URLSession? = nil,
        credentialStore: any ChatGPTCredentialStore = KeychainChatGPTCredentialStore(),
        refreshLeeway: TimeInterval = 60,
    ) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        let session = session ?? URLSession(configuration: configuration)
        transport = URLSessionOAuthHTTPTransport(session: session)
        self.credentialStore = credentialStore
        self.refreshLeeway = max(0, refreshLeeway)
        now = { Date() }
    }

    init(
        transport: any OAuthHTTPTransport,
        credentialStore: any ChatGPTCredentialStore,
        refreshLeeway: TimeInterval = 60,
        now: @escaping @Sendable () -> Date = { Date() },
    ) {
        self.transport = transport
        self.credentialStore = credentialStore
        self.refreshLeeway = max(0, refreshLeeway)
        self.now = now
    }

    public func loadAccount(issuedClientID: String) throws -> ChatGPTStoredAccount? {
        try credentialStore.loadAccount(issuedClientID: issuedClientID)
    }

    public func accountWithFreshAccessToken(issuedClientID: String) async throws -> ChatGPTStoredAccount {
        guard !signingOut.contains(issuedClientID) else { throw ChatGPTOAuthError.sessionSigningOut }
        if let task = refreshTasks[issuedClientID] {
            return try await task.value
        }

        guard let account = try credentialStore.loadAccount(issuedClientID: issuedClientID) else {
            throw ChatGPTOAuthError.accountNotFound
        }
        guard account.credentials != nil else { throw ChatGPTOAuthError.reauthorizationRequired }
        guard account.expiresAt != nil else { throw ChatGPTOAuthError.reauthorizationRequired }
        return try await refreshSingleFlight(account, forceRefresh: false)
    }

    public func refreshNow(issuedClientID: String) async throws -> ChatGPTStoredAccount {
        guard !signingOut.contains(issuedClientID) else { throw ChatGPTOAuthError.sessionSigningOut }
        if let task = refreshTasks[issuedClientID] {
            return try await task.value
        }
        guard let account = try credentialStore.loadAccount(issuedClientID: issuedClientID) else {
            throw ChatGPTOAuthError.accountNotFound
        }
        return try await refreshSingleFlight(account, forceRefresh: true)
    }

    public func signOut(issuedClientID: String) async throws -> ChatGPTSignOutResult {
        guard signingOut.insert(issuedClientID).inserted else { throw ChatGPTOAuthError.sessionSigningOut }
        defer { signingOut.remove(issuedClientID) }

        if let task = refreshTasks[issuedClientID] {
            _ = try? await task.value
        }
        guard let account = try credentialStore.loadAccount(issuedClientID: issuedClientID) else {
            throw ChatGPTOAuthError.accountNotFound
        }

        return try await ChatGPTCredentialOperationCoordinator.shared.withAccountLock(
            hostIdentifier: account.hostIdentifier,
            invalidatingAuthorizations: true,
        ) { _ in
            try await self.finishSignOut(
                issuedClientID: issuedClientID,
                expectedHostIdentifier: account.hostIdentifier,
            )
        }
    }
}
