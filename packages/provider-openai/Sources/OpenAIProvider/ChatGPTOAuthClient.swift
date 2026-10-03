import Foundation
import JWTKit

public final class ChatGPTOAuthClient: Sendable {
    let session: URLSession
    private let agentName: String

    public init(session: URLSession? = nil, agentName: String = "Orot") {
        self.session = session ?? Self.makeEphemeralSession()
        self.agentName = agentName
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
        redirectURI: URL
    ) async throws -> PendingChatGPTAuthorization {
        guard UserDefaultsHostIdentifierStore.isValidHostIdentifier(hostIdentifier) else {
            throw ChatGPTOAuthError.invalidHostIdentifier
        }
        guard Self.isValidRedirectURI(redirectURI) else {
            throw ChatGPTOAuthError.invalidRedirectURI
        }

        let discovery = try await loadDiscovery()
        let state = try PKCE.randomURLSafeValue()
        let nonce = try PKCE.randomURLSafeValue()
        let verifier = try PKCE.randomURLSafeValue()

        let authorizationURL = try AuthorizationRequestBuilder.build(
            discovery: discovery,
            hostIdentifier: hostIdentifier,
            redirectURI: redirectURI,
            state: state,
            nonce: nonce,
            verifier: verifier,
            agentName: agentName
        )

        return PendingChatGPTAuthorization(
            authorizationURL: authorizationURL,
            redirectURI: redirectURI,
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
            expectedRedirectURI: pending.redirectURI
        )
        let tokens = try await exchangeCode(callback, pending: pending)
        let identity = try await verifyIdentity(
            idToken: tokens.idToken,
            clientID: callback.issuedClientID,
            nonce: pending.nonce,
            discovery: pending.discovery
        )

        return ChatGPTAccountAccess(
            issuedClientID: callback.issuedClientID,
            subject: identity.subject,
            grantedScopes: Set(tokens.scope.split(whereSeparator: \.isWhitespace).map(String.init)),
            accessToken: tokens.accessToken
        )
    }

    private func loadDiscovery() async throws -> OpenIDConfiguration {
        let url = URL(string: "\(ChatGPTOAuthConstants.issuer)/.well-known/openid-configuration")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw ChatGPTOAuthError.discoveryUnavailable
        }
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              data.count <= 262_144,
              let discovery = try? JSONDecoder().decode(OpenIDConfiguration.self, from: data),
              Self.isValid(discovery) else {
            throw ChatGPTOAuthError.discoveryUnavailable
        }
        return discovery
    }

    private func exchangeCode(
        _ callback: OAuthCallback,
        pending: PendingChatGPTAuthorization
    ) async throws -> TokenResponse {
        let request = TokenExchangeRequestBuilder.build(
            endpoint: pending.discovery.tokenEndpoint,
            clientID: callback.issuedClientID,
            code: callback.code,
            codeVerifier: pending.codeVerifier,
            redirectURI: pending.redirectURI
        )

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw ChatGPTOAuthError.providerFailure
        }
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              data.count <= 262_144,
              let tokens = try? JSONDecoder().decode(TokenResponse.self, from: data),
              tokens.tokenType.caseInsensitiveCompare("Bearer") == .orderedSame,
              !tokens.idToken.isEmpty,
              !tokens.accessToken.isEmpty,
              !tokens.scope.isEmpty else {
            throw ChatGPTOAuthError.invalidTokenResponse
        }
        return tokens
    }

    private func verifyIdentity(
        idToken: String,
        clientID: String,
        nonce: String,
        discovery: OpenIDConfiguration
    ) async throws -> VerifiedIdentity {
        var request = URLRequest(url: discovery.jwksURI)
        request.httpMethod = "GET"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw ChatGPTOAuthError.discoveryUnavailable
        }
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              data.count <= 262_144 else {
            throw ChatGPTOAuthError.discoveryUnavailable
        }
        return try await IDTokenVerifier().verify(
            idToken,
            jwksData: data,
            clientID: clientID,
            nonce: nonce,
            now: Date()
        )
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

private struct TokenResponse: Decodable {
    let idToken: String
    let accessToken: String
    let tokenType: String
    let scope: String

    enum CodingKeys: String, CodingKey {
        case idToken = "id_token"
        case accessToken = "access_token"
        case tokenType = "token_type"
        case scope
    }
}
