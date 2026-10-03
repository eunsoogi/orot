import Foundation

public actor ChatGPTSessionManager {
    let transport: any OAuthHTTPTransport
    private let credentialStore: any ChatGPTCredentialStore
    private let refreshLeeway: TimeInterval
    private let now: @Sendable () -> Date
    private var refreshTasks: [String: Task<ChatGPTStoredAccount, Error>] = [:]
    private var signingOut = Set<String>()

    public init(
        session: URLSession? = nil,
        credentialStore: any ChatGPTCredentialStore = KeychainChatGPTCredentialStore(),
        refreshLeeway: TimeInterval = 60
    ) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        let session = session ?? URLSession(configuration: configuration)
        self.transport = URLSessionOAuthHTTPTransport(session: session)
        self.credentialStore = credentialStore
        self.refreshLeeway = max(0, refreshLeeway)
        self.now = { Date() }
    }

    init(
        transport: any OAuthHTTPTransport,
        credentialStore: any ChatGPTCredentialStore,
        refreshLeeway: TimeInterval = 60,
        now: @escaping @Sendable () -> Date = { Date() }
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
        guard let credentials = account.credentials else { throw ChatGPTOAuthError.reauthorizationRequired }
        guard let expiresAt = account.expiresAt else { throw ChatGPTOAuthError.reauthorizationRequired }
        if expiresAt > now().addingTimeInterval(refreshLeeway) {
            return account
        }
        guard credentials.refreshToken != nil else { throw ChatGPTOAuthError.reauthorizationRequired }
        return try await refreshSingleFlight(account)
    }

    public func refreshNow(issuedClientID: String) async throws -> ChatGPTStoredAccount {
        guard !signingOut.contains(issuedClientID) else { throw ChatGPTOAuthError.sessionSigningOut }
        if let task = refreshTasks[issuedClientID] {
            return try await task.value
        }
        guard let account = try credentialStore.loadAccount(issuedClientID: issuedClientID) else {
            throw ChatGPTOAuthError.accountNotFound
        }
        return try await refreshSingleFlight(account)
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

        var remoteRevocationConfirmed = false
        if let refreshToken = account.credentials?.refreshToken {
            remoteRevocationConfirmed = await revokeRenewableSession(
                refreshToken,
                issuedClientID: account.issuedClientID
            )
        }

        try credentialStore.clearCredentials(issuedClientID: issuedClientID)
        return remoteRevocationConfirmed ? .revoked : .localCredentialsCleared
    }

    private func refreshSingleFlight(_ account: ChatGPTStoredAccount) async throws -> ChatGPTStoredAccount {
        let clientID = account.issuedClientID
        if let task = refreshTasks[clientID] {
            return try await task.value
        }

        let task = Task { try await self.performRefresh(account) }
        refreshTasks[clientID] = task
        do {
            let refreshed = try await task.value
            refreshTasks[clientID] = nil
            return refreshed
        } catch {
            refreshTasks[clientID] = nil
            throw error
        }
    }

    private func performRefresh(_ account: ChatGPTStoredAccount) async throws -> ChatGPTStoredAccount {
        guard let oldCredentials = account.credentials,
              let refreshToken = oldCredentials.refreshToken else {
            throw ChatGPTOAuthError.reauthorizationRequired
        }

        let configuration = try await OpenIDConfigurationLoader.load(using: transport)
        let request = TokenExchangeRequestBuilder.buildRefresh(
            endpoint: configuration.tokenEndpoint,
            clientID: account.issuedClientID,
            refreshToken: refreshToken
        )

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await transport.data(for: request)
        } catch {
            throw ChatGPTOAuthError.providerFailure
        }
        guard let http = response as? HTTPURLResponse else { throw ChatGPTOAuthError.providerFailure }
        guard http.statusCode == 200 else {
            let endpointError = try? JSONDecoder().decode(OAuthTokenEndpointError.self, from: data)
            if Self.isTerminalRefreshError(endpointError?.code) {
                try credentialStore.clearCredentials(issuedClientID: account.issuedClientID)
                throw ChatGPTOAuthError.reauthorizationRequired
            }
            throw ChatGPTOAuthError.providerFailure
        }

        guard data.count <= 262_144,
              let tokens = try? JSONDecoder().decode(OAuthTokenResponse.self, from: data),
              let accessToken = tokens.accessToken, !accessToken.isEmpty,
              let newRefreshToken = tokens.refreshToken, !newRefreshToken.isEmpty,
              let tokenType = tokens.tokenType,
              tokenType.caseInsensitiveCompare("Bearer") == .orderedSame,
              let expiresIn = tokens.expiresIn,
              expiresIn.isFinite,
              expiresIn > 0,
              tokens.scope.map(Self.isValidScopeResponse) ?? true else {
            throw ChatGPTOAuthError.invalidTokenResponse
        }

        let scopes = tokens.scope.map(Self.scopes(from:)) ?? account.grantedScopes
        let newCredentials = ChatGPTStoredCredentials(
            accessToken: accessToken,
            refreshToken: newRefreshToken,
            idToken: oldCredentials.idToken,
            tokenType: "Bearer"
        )
        let refreshed = account.replacingCredentials(
            newCredentials,
            scopes: scopes,
            expiresAt: now().addingTimeInterval(expiresIn)
        )
        try credentialStore.saveAccount(refreshed)
        return refreshed
    }

    private static func isTerminalRefreshError(_ code: String?) -> Bool {
        guard let code else { return false }
        return [
            "invalid_grant",
            "invalid_refresh_token",
            "token_expired",
            "refresh_token_expired",
            "refresh_token_invalidated",
            "refresh_token_reused",
        ].contains(code)
    }

    private static func scopes(from response: String) -> Set<String> {
        Set(response.split(whereSeparator: \.isWhitespace).map(String.init))
    }

    private static func isValidScopeResponse(_ response: String) -> Bool {
        !response.isEmpty && !scopes(from: response).isEmpty
    }
}

struct OAuthTokenEndpointError: Decodable {
    let code: String?

    enum CodingKeys: String, CodingKey {
        case code = "error"
    }
}

struct OAuthTokenResponse: Decodable {
    let accessToken: String?
    let refreshToken: String?
    let idToken: String?
    let tokenType: String?
    let expiresIn: TimeInterval?
    let scope: String?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case idToken = "id_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case scope
    }
}
