import Foundation

enum AuthorizationRequestBuilder {
    static func build(
        discovery: OpenIDConfiguration,
        hostIdentifier: String,
        redirectURI: URL,
        state: String,
        nonce: String,
        verifier: String,
        agentName: String
    ) throws -> URL {
        guard UserDefaultsHostIdentifierStore.isValidHostIdentifier(hostIdentifier),
              !state.isEmpty,
              !nonce.isEmpty,
              !agentName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ChatGPTOAuthError.invalidAuthorizationRequest
        }
        guard ChatGPTOAuthClient.isValidRedirectURI(redirectURI) else {
            throw ChatGPTOAuthError.invalidRedirectURI
        }

        var components = URLComponents(url: discovery.authorizationEndpoint, resolvingAgainstBaseURL: false)
        guard components?.queryItems == nil else { throw ChatGPTOAuthError.discoveryUnavailable }
        components?.queryItems = [
            URLQueryItem(name: "client_id", value: ChatGPTOAuthConstants.initialClientID),
            URLQueryItem(name: "agent_name_hint", value: agentName),
            URLQueryItem(name: "ext_agent_host_id", value: hostIdentifier),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "redirect_uri", value: redirectURI.absoluteString),
            URLQueryItem(name: "scope", value: ChatGPTOAuthConstants.scopes),
            URLQueryItem(name: "resource", value: ChatGPTOAuthConstants.resource),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "nonce", value: nonce),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "code_challenge", value: PKCE.challenge(for: verifier)),
        ]
        guard let url = components?.url else { throw ChatGPTOAuthError.discoveryUnavailable }
        return url
    }
}
