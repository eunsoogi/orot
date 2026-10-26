import Foundation
import JWTKit

enum OpenIDConfigurationLoader {
    static func load(using transport: any OAuthHTTPTransport) async throws -> OpenIDConfiguration {
        let url = URL(string: "\(ChatGPTOAuthConstants.issuer)/.well-known/openid-configuration")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await transport.data(for: request)
        } catch {
            throw ChatGPTOAuthError.discoveryUnavailable
        }
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              data.count <= 262_144,
              let configuration = try? JSONDecoder().decode(OpenIDConfiguration.self, from: data),
              ChatGPTOAuthClient.isValid(configuration)
        else {
            throw ChatGPTOAuthError.discoveryUnavailable
        }
        return configuration
    }
}

extension ChatGPTOAuthClient {
    func exchangeCode(
        _ callback: OAuthCallback,
        pending: PendingChatGPTAuthorization,
    ) async throws -> OAuthTokenResponse {
        let request = TokenExchangeRequestBuilder.build(
            endpoint: pending.discovery.tokenEndpoint,
            clientID: callback.issuedClientID,
            code: callback.code,
            codeVerifier: pending.codeVerifier,
            redirectURI: pending.redirectURI,
        )

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await transport.data(for: request)
        } catch {
            throw ChatGPTOAuthError.providerFailure
        }
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              data.count <= 262_144,
              let tokens = try? JSONDecoder().decode(OAuthTokenResponse.self, from: data)
        else {
            throw ChatGPTOAuthError.invalidTokenResponse
        }
        return tokens
    }

    func verifyIdentity(
        idToken: String,
        clientID: String,
        nonce: String,
        discovery: OpenIDConfiguration,
    ) async throws -> VerifiedIdentity {
        var request = URLRequest(url: discovery.jwksURI)
        request.httpMethod = "GET"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await transport.data(for: request)
        } catch {
            throw ChatGPTOAuthError.discoveryUnavailable
        }
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              data.count <= 262_144
        else {
            throw ChatGPTOAuthError.discoveryUnavailable
        }
        return try await IDTokenVerifier().verify(
            idToken,
            jwksData: data,
            clientID: clientID,
            nonce: nonce,
            now: Date(),
        )
    }
}
