import Foundation

extension ChatGPTSessionManager {
    func saveAuthorizedAccount(
        _ account: ChatGPTStoredAccount,
        expectedAuthorizationGeneration: UInt64
    ) async throws {
        guard !signingOut.contains(account.issuedClientID) else {
            throw ChatGPTOAuthError.sessionSigningOut
        }
        try await ChatGPTCredentialOperationCoordinator.shared.withAccountLock(
            hostIdentifier: account.hostIdentifier
        ) { generation in
            try await self.saveAuthorizedAccountUnderLock(
                account,
                expectedAuthorizationGeneration: expectedAuthorizationGeneration,
                currentAuthorizationGeneration: generation
            )
        }
    }

    private func saveAuthorizedAccountUnderLock(
        _ account: ChatGPTStoredAccount,
        expectedAuthorizationGeneration: UInt64,
        currentAuthorizationGeneration: UInt64
    ) throws {
        guard !signingOut.contains(account.issuedClientID) else {
            throw ChatGPTOAuthError.sessionSigningOut
        }
        try Task.checkCancellation()
        guard currentAuthorizationGeneration == expectedAuthorizationGeneration else {
            throw ChatGPTOAuthError.sessionSigningOut
        }
        try credentialStore.saveAccount(account)
    }

    func finishSignOut(
        issuedClientID: String,
        expectedHostIdentifier: String
    ) async throws -> ChatGPTSignOutResult {
        guard let account = try credentialStore.loadAccount(issuedClientID: issuedClientID),
              account.hostIdentifier == expectedHostIdentifier else {
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
}
