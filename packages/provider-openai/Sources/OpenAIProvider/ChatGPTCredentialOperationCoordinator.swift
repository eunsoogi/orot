import Foundation

actor ChatGPTCredentialOperationCoordinator {
    static let shared = ChatGPTCredentialOperationCoordinator()

    // A host ID is available before dynamic registration and shared by client wrappers.
    private var heldAccounts = Set<String>()
    private var waiters: [String: [CheckedContinuation<Void, Never>]] = [:]
    private var authorizationGenerations: [String: UInt64] = [:]
    private var signOutInProgress = Set<String>()

    func authorizationGeneration(for hostIdentifier: String) throws -> UInt64 {
        guard !signOutInProgress.contains(hostIdentifier) else {
            throw ChatGPTOAuthError.sessionSigningOut
        }
        return authorizationGenerations[hostIdentifier, default: 0]
    }

    func withAccountLock<Value: Sendable>(
        hostIdentifier: String,
        invalidatingAuthorizations: Bool = false,
        operation: @Sendable (UInt64) async throws -> Value,
    ) async throws -> Value {
        await acquire(hostIdentifier)
        if invalidatingAuthorizations {
            authorizationGenerations[hostIdentifier, default: 0] &+= 1
            signOutInProgress.insert(hostIdentifier)
        }
        let generation = authorizationGenerations[hostIdentifier, default: 0]

        do {
            let value = try await operation(generation)
            release(hostIdentifier, finishingSignOut: invalidatingAuthorizations)
            return value
        } catch {
            release(hostIdentifier, finishingSignOut: invalidatingAuthorizations)
            throw error
        }
    }

    private func acquire(_ hostIdentifier: String) async {
        if heldAccounts.insert(hostIdentifier).inserted {
            return
        }
        await withCheckedContinuation { waiters[hostIdentifier, default: []].append($0) }
    }

    private func release(_ hostIdentifier: String, finishingSignOut: Bool) {
        if finishingSignOut {
            signOutInProgress.remove(hostIdentifier)
        }
        guard var pending = waiters[hostIdentifier], !pending.isEmpty else {
            heldAccounts.remove(hostIdentifier)
            waiters[hostIdentifier] = nil
            return
        }
        let next = pending.removeFirst()
        waiters[hostIdentifier] = pending.isEmpty ? nil : pending
        next.resume()
    }
}
