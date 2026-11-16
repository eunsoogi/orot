import Foundation
import OpenAIProvider
import React

/// Model discovery reports local protocol eligibility, not account-policy acceptance.
public extension OpenAIProviderModule {
    @objc(listModels:resolver:rejecter:)
    func listModels(_ issuedClientID: String, resolver resolve: @escaping RCTPromiseResolveBlock,
                    rejecter reject: @escaping RCTPromiseRejectBlock)
    {
        Task {
            do {
                let models = try await activeClient.listModels(forIssuedClientID: issuedClientID)
                // Local protocol eligibility after direct-plan authorization; not a server capability claim.
                resolve(models.map { ["slug": $0.slug, "displayName": $0.displayName,
                                      "supportsMidTurnSteering": ChatGPTSteerableResponse.supportsModel($0.slug)] as NSDictionary })
            } catch {
                let details = OpenAIProviderErrorDetails.make(error)
                let message = details["message"] as? String ?? "ChatGPT model discovery failed."
                var userInfo = details
                userInfo[NSLocalizedDescriptionKey] = message
                let rejection = NSError(
                    domain: "OpenAIProvider",
                    code: details["httpStatusCode"] as? Int ?? 1,
                    userInfo: userInfo,
                )
                reject(details["code"] as? String ?? "CHATGPT_PROVIDER_ERROR", message, rejection)
            }
        }
    }
}
