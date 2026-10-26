import Foundation

extension ChatGPTSessionManager {
    func refreshSingleFlight(
        _ account: ChatGPTStoredAccount,
        forceRefresh: Bool,
    ) async throws -> ChatGPTStoredAccount {
        guard !signingOut.contains(account.issuedClientID) else {
            throw ChatGPTOAuthError.sessionSigningOut
        }
        let clientID = account.issuedClientID
        if let task = refreshTasks[clientID] {
            return try await task.value
        }

        let task = Task {
            try await ChatGPTCredentialOperationCoordinator.shared.withAccountLock(
                hostIdentifier: account.hostIdentifier,
            ) { _ in
                try await self.refreshUnderLock(account, forceRefresh: forceRefresh)
            }
        }
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

    private func refreshUnderLock(
        _ requestedAccount: ChatGPTStoredAccount,
        forceRefresh: Bool,
    ) async throws -> ChatGPTStoredAccount {
        guard !signingOut.contains(requestedAccount.issuedClientID) else {
            throw ChatGPTOAuthError.sessionSigningOut
        }
        guard let account = try credentialStore.loadAccount(issuedClientID: requestedAccount.issuedClientID),
              account.hostIdentifier == requestedAccount.hostIdentifier
        else {
            throw ChatGPTOAuthError.accountNotFound
        }
        guard let credentials = account.credentials else {
            throw ChatGPTOAuthError.reauthorizationRequired
        }
        guard let expiresAt = account.expiresAt else {
            throw ChatGPTOAuthError.reauthorizationRequired
        }

        let changedSinceRequest = account != requestedAccount
        if changedSinceRequest, forceRefresh {
            return account
        }
        if !forceRefresh, expiresAt > now().addingTimeInterval(refreshLeeway) {
            return account
        }
        guard credentials.refreshToken != nil else {
            throw ChatGPTOAuthError.reauthorizationRequired
        }
        return try await performRefresh(account)
    }

    private func performRefresh(_ account: ChatGPTStoredAccount) async throws -> ChatGPTStoredAccount {
        guard let oldCredentials = account.credentials,
              let refreshToken = oldCredentials.refreshToken
        else {
            throw ChatGPTOAuthError.reauthorizationRequired
        }

        let configuration = try await OpenIDConfigurationLoader.load(using: transport)
        let request = TokenExchangeRequestBuilder.buildRefresh(
            endpoint: configuration.tokenEndpoint,
            clientID: account.issuedClientID,
            refreshToken: refreshToken,
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
              tokens.scope.map(Self.isValidScopeResponse) ?? true
        else {
            throw ChatGPTOAuthError.invalidTokenResponse
        }

        let scopes = tokens.scope.map(Self.scopes(from:)) ?? account.grantedScopes
        let newCredentials = ChatGPTStoredCredentials(
            accessToken: accessToken,
            refreshToken: newRefreshToken,
            idToken: oldCredentials.idToken,
            tokenType: "Bearer",
        )
        let refreshed = account.replacingCredentials(
            newCredentials,
            scopes: scopes,
            expiresAt: now().addingTimeInterval(expiresIn),
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
