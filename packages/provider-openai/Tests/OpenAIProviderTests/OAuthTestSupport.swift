import Foundation
@testable import OpenAIProvider

final class InMemoryChatGPTCredentialStore: ChatGPTCredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var hostIdentifier = "urn:uuid:8dc1e299-3e2b-45d7-a2c1-57a3154ae032"
    private var accounts: [String: ChatGPTStoredAccount] = [:]

    func loadOrCreateHostIdentifier() throws -> String {
        lock.lock()
        defer { lock.unlock() }
        return hostIdentifier
    }

    func loadAccount(issuedClientID: String) throws -> ChatGPTStoredAccount? {
        lock.lock()
        defer { lock.unlock() }
        return accounts[issuedClientID]
    }

    func saveAccount(_ account: ChatGPTStoredAccount) throws {
        lock.lock()
        defer { lock.unlock() }
        accounts[account.issuedClientID] = account
    }

    func clearCredentials(issuedClientID: String) throws {
        lock.lock()
        defer { lock.unlock() }
        guard let account = accounts[issuedClientID] else { return }
        accounts[issuedClientID] = account.replacingCredentials(nil, expiresAt: nil)
    }

    func removeAccount(issuedClientID: String) throws {
        lock.lock()
        defer { lock.unlock() }
        accounts.removeValue(forKey: issuedClientID)
    }
}

struct StubOAuthResponse: Sendable {
    let statusCode: Int
    let body: Data
    var requestID: String? = nil
}

actor RequestGate {
    private var isOpen = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        guard !isOpen else { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func open() {
        isOpen = true
        let pending = waiters
        waiters.removeAll()
        pending.forEach { $0.resume() }
    }
}

actor StubOAuthHTTPTransport: OAuthHTTPTransport {
    typealias Responder = @Sendable (URLRequest) async throws -> StubOAuthResponse

    private let responder: Responder
    private var requests: [URLRequest] = []
    private var requestWaiters: [(path: String, count: Int, continuation: CheckedContinuation<Void, Never>)] = []

    init(responder: @escaping Responder) {
        self.responder = responder
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        requests.append(request)
        resumeRequestWaiters()
        let result = try await responder(request)
        var headers = ["Content-Type": "application/json"]
        if let requestID = result.requestID { headers["x-request-id"] = requestID }
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: result.statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        )!
        return (result.body, response)
    }

    func waitForRequest(path: String, count: Int = 1) async {
        guard requests.filter({ $0.url?.path == path }).count < count else { return }
        await withCheckedContinuation { continuation in
            requestWaiters.append((path, count, continuation))
        }
    }

    func recordedRequests(path: String) -> [URLRequest] {
        requests.filter { $0.url?.path == path }
    }

    private func resumeRequestWaiters() {
        let ready = requestWaiters.filter { waiter in
            requests.filter({ $0.url?.path == waiter.path }).count >= waiter.count
        }
        requestWaiters.removeAll { waiter in
            requests.filter({ $0.url?.path == waiter.path }).count >= waiter.count
        }
        ready.forEach { $0.continuation.resume() }
    }
}

func syntheticAccount(
    expiresAt: Date,
    scopes: Set<String> = ["openid", "offline_access", ChatGPTOAuthConstants.directPlanScope],
    refreshToken: String? = "fixture-refresh-token"
) -> ChatGPTStoredAccount {
    ChatGPTStoredAccount(
        issuedClientID: "oaiapp_fixture_client",
        hostIdentifier: "urn:uuid:0cc04a4c-0f3a-4f49-8bda-10675883a491",
        subject: "fixture-subject",
        grantedScopes: scopes,
        expiresAt: expiresAt,
        credentials: ChatGPTStoredCredentials(
            accessToken: "fixture-access-token",
            refreshToken: refreshToken,
            idToken: "fixture-id-token",
            tokenType: "Bearer"
        )
    )
}

func discoveryResponse() -> StubOAuthResponse {
    StubOAuthResponse(
        statusCode: 200,
        body: Data(
            """
            {"issuer":"https://auth.openai.com","authorization_endpoint":"https://auth.openai.com/api/accounts/authorize","token_endpoint":"https://auth.openai.com/api/accounts/oauth/token","jwks_uri":"https://auth.openai.com/oauth2/v1/keys","revocation_endpoint":"https://auth.openai.com/api/accounts/oauth/revoke"}
            """.utf8
        )
    )
}

func refreshedTokenResponse(
    access: String = "fixture-access-token-rotated",
    refresh: String = "fixture-refresh-token-rotated",
    scope: String? = nil
) -> StubOAuthResponse {
    var values = [
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "Bearer",
        "expires_in": 3600,
    ] as [String: Any]
    if let scope { values["scope"] = scope }
    return StubOAuthResponse(statusCode: 200, body: try! JSONSerialization.data(withJSONObject: values))
}
