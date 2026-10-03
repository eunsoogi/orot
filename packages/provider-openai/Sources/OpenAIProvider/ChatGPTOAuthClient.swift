import Foundation

public final class ChatGPTOAuthClient: Sendable {
    let transport: any OAuthHTTPTransport
    private let agentName: String
    private let credentialStore: any ChatGPTCredentialStore
    let sessionManager: ChatGPTSessionManager

    public init(
        session: URLSession? = nil,
        agentName: String = "Orot",
        credentialStore: any ChatGPTCredentialStore = KeychainChatGPTCredentialStore()
    ) {
        let session = session ?? Self.makeEphemeralSession()
        let transport = URLSessionOAuthHTTPTransport(session: session)
        self.transport = transport
        self.agentName = agentName
        self.credentialStore = credentialStore
        self.sessionManager = ChatGPTSessionManager(
            transport: transport,
            credentialStore: credentialStore
        )
    }

    init(
        transport: any OAuthHTTPTransport,
        agentName: String = "Orot",
        credentialStore: any ChatGPTCredentialStore
    ) {
        self.transport = transport
        self.agentName = agentName
        self.credentialStore = credentialStore
        self.sessionManager = ChatGPTSessionManager(
            transport: transport,
            credentialStore: credentialStore
        )
    }

    private static func makeEphemeralSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        return URLSession(configuration: configuration)
    }

    public func prepareAuthorization(
        hostIdentifier: String,
        redirectURI: URL,
        existingIssuedClientID: String? = nil
    ) async throws -> PendingChatGPTAuthorization {
        guard UserDefaultsHostIdentifierStore.isValidHostIdentifier(hostIdentifier) else {
            throw ChatGPTOAuthError.invalidHostIdentifier
        }
        guard Self.isValidRedirectURI(redirectURI) else {
            throw ChatGPTOAuthError.invalidRedirectURI
        }

        let discovery = try await OpenIDConfigurationLoader.load(using: transport)
        let state = try PKCE.randomURLSafeValue()
        let nonce = try PKCE.randomURLSafeValue()
        let verifier = try PKCE.randomURLSafeValue()

        var requestedClientID = ChatGPTOAuthConstants.initialClientID
        var expectedSubject: String?
        var idTokenHint: String?
        if let existingIssuedClientID {
            guard let account = try credentialStore.loadAccount(issuedClientID: existingIssuedClientID) else {
                throw ChatGPTOAuthError.accountNotFound
            }
            guard account.hostIdentifier == hostIdentifier else {
                throw ChatGPTOAuthError.invalidHostIdentifier
            }
            requestedClientID = account.issuedClientID
            expectedSubject = account.subject
            idTokenHint = account.credentials?.idToken
        }

        let authorizationURL = try AuthorizationRequestBuilder.build(
            discovery: discovery,
            hostIdentifier: hostIdentifier,
            redirectURI: redirectURI,
            state: state,
            nonce: nonce,
            verifier: verifier,
            agentName: agentName,
            clientID: requestedClientID,
            idTokenHint: idTokenHint
        )

        return PendingChatGPTAuthorization(
            authorizationURL: authorizationURL,
            redirectURI: redirectURI,
            hostIdentifier: hostIdentifier,
            requestedClientID: requestedClientID,
            expectedSubject: expectedSubject,
            idTokenHint: idTokenHint,
            state: state,
            nonce: nonce,
            codeVerifier: verifier,
            discovery: discovery
        )
    }

    public func completeAuthorization(
        callbackURL: URL,
        pending: PendingChatGPTAuthorization
    ) async throws -> ChatGPTAccountAccess {
        let callback = try OAuthCallbackParser.parse(
            callbackURL,
            expectedState: pending.state,
            expectedRedirectURI: pending.redirectURI,
            expectedClientID: pending.requestedClientID
        )
        let tokens = try await exchangeCode(callback, pending: pending)
        guard let idToken = tokens.idToken,
              let accessToken = tokens.accessToken,
              let tokenType = tokens.tokenType,
              tokenType.caseInsensitiveCompare("Bearer") == .orderedSame,
              let expiresIn = tokens.expiresIn,
              expiresIn.isFinite,
              expiresIn > 0,
              let scope = tokens.scope else {
            throw ChatGPTOAuthError.invalidTokenResponse
        }
        let grantedScopes = Set(scope.split(whereSeparator: \.isWhitespace).map(String.init))
        guard grantedScopes.contains("openid"),
              !accessToken.isEmpty,
              !idToken.isEmpty,
              !scope.isEmpty,
              !grantedScopes.contains("offline_access") || tokens.refreshToken?.isEmpty == false else {
            throw ChatGPTOAuthError.invalidTokenResponse
        }
        let identity = try await verifyIdentity(
            idToken: idToken,
            clientID: callback.issuedClientID,
            nonce: pending.nonce,
            discovery: pending.discovery
        )
        if let expectedSubject = pending.expectedSubject, expectedSubject != identity.subject {
            throw ChatGPTOAuthError.accountIdentityMismatch
        }

        let account = ChatGPTStoredAccount(
            issuedClientID: callback.issuedClientID,
            hostIdentifier: pending.hostIdentifier,
            subject: identity.subject,
            grantedScopes: grantedScopes,
            expiresAt: Date().addingTimeInterval(expiresIn),
            credentials: ChatGPTStoredCredentials(
                accessToken: accessToken,
                refreshToken: tokens.refreshToken,
                idToken: idToken,
                tokenType: "Bearer"
            )
        )
        try credentialStore.saveAccount(account)

        return ChatGPTAccountAccess(
            issuedClientID: callback.issuedClientID,
            subject: identity.subject,
            grantedScopes: grantedScopes,
            accessToken: accessToken
        )
    }

    public func prepareAuthorization(
        redirectURI: URL,
        existingIssuedClientID: String? = nil
    ) async throws -> PendingChatGPTAuthorization {
        let hostIdentifier = try credentialStore.loadOrCreateHostIdentifier()
        return try await prepareAuthorization(
            hostIdentifier: hostIdentifier,
            redirectURI: redirectURI,
            existingIssuedClientID: existingIssuedClientID
        )
    }

    public func accountWithFreshAccessToken(issuedClientID: String) async throws -> ChatGPTStoredAccount {
        try await sessionManager.accountWithFreshAccessToken(issuedClientID: issuedClientID)
    }

    public func signOut(issuedClientID: String) async throws -> ChatGPTSignOutResult {
        try await sessionManager.signOut(issuedClientID: issuedClientID)
    }

    static func isValidRedirectURI(_ url: URL) -> Bool {
        url.scheme == "http"
            && url.host == "127.0.0.1"
            && url.port != nil
            && url.port != 0
            && url.path == ChatGPTOAuthConstants.callbackPath
            && url.user == nil
            && url.password == nil
            && url.query == nil
            && url.fragment == nil
    }

    static func isValid(_ value: OpenIDConfiguration) -> Bool {
        value.issuer == ChatGPTOAuthConstants.issuer
            && isTrustedEndpoint(value.authorizationEndpoint)
            && isTrustedEndpoint(value.tokenEndpoint)
            && isTrustedEndpoint(value.jwksURI)
            && isTrustedEndpoint(value.revocationEndpoint)
    }

    static func isTrustedEndpoint(_ url: URL) -> Bool {
        url.scheme == "https"
            && url.host == "auth.openai.com"
            && url.port == nil
            && url.user == nil
            && url.password == nil
            && url.fragment == nil
    }
}
