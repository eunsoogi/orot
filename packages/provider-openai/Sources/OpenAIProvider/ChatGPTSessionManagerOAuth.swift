import Foundation

private let revocationRetryDelaysNanoseconds: [UInt64] = [100_000_000, 400_000_000]

extension ChatGPTSessionManager {
    func revokeRenewableSession(_ refreshToken: String, issuedClientID: String) async -> Bool {
        var retryIndex = 0
        while true {
            guard !Task.isCancelled else { return false }
            guard let configuration = try? await OpenIDConfigurationLoader.load(using: transport) else {
                guard retryIndex < revocationRetryDelaysNanoseconds.count else { return false }
                await waitBeforeRevocationRetry(at: retryIndex)
                retryIndex += 1
                continue
            }

            let request = TokenExchangeRequestBuilder.buildRevocation(
                endpoint: configuration.revocationEndpoint,
                clientID: issuedClientID,
                refreshToken: refreshToken,
            )
            do {
                let (_, response) = try await transport.data(for: request)
                let statusCode = (response as? HTTPURLResponse)?.statusCode
                if statusCode == 200 {
                    return true
                }
                guard let statusCode,
                      (500 ... 599).contains(statusCode),
                      retryIndex < revocationRetryDelaysNanoseconds.count
                else {
                    return false
                }
            } catch {
                guard !Task.isCancelled, retryIndex < revocationRetryDelaysNanoseconds.count else {
                    return false
                }
            }

            await waitBeforeRevocationRetry(at: retryIndex)
            retryIndex += 1
        }
    }

    private func waitBeforeRevocationRetry(at index: Int) async {
        try? await Task.sleep(nanoseconds: revocationRetryDelaysNanoseconds[index])
    }
}
