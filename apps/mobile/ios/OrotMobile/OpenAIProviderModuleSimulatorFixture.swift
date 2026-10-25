#if DEBUG && targetEnvironment(simulator)
    import Foundation
    import OpenAIProvider
    import React

    /// Exposes synthetic auth return and offline account fixtures only to Debug Simulators.
    public extension OpenAIProviderModule {
        @objc(probeAuthSessionCancellation:rejecter:)
        func probeAuthSessionCancellation(
            resolver resolve: @escaping RCTPromiseResolveBlock,
            rejecter reject: @escaping RCTPromiseRejectBlock,
        ) {
            Task { @MainActor in
                do {
                    try await OpenAIProviderAuthCoordinator.shared.probeAuthSessionCancellation()
                    resolve("verified")
                } catch {
                    reject("AUTH_SESSION_CANCEL_PROBE_FAILED", "Synthetic browser cancellation failed.", nil)
                }
            }
        }

        @objc(prepareSyntheticFixture:resolver:rejecter:)
        func prepareSyntheticFixture(
            _ scenario: String,
            resolver resolve: @escaping RCTPromiseResolveBlock,
            rejecter reject: @escaping RCTPromiseRejectBlock,
        ) {
            if scenario == "authSessionReturn" {
                Task { @MainActor in
                    do {
                        // Exercise callback capture without exchanging the synthetic OAuth code.
                        try await OpenAIProviderAuthCoordinator.shared.probeAuthSessionReturn()
                        try restoreSyntheticAccountAfterAuthReturn()
                        resolve(["authSessionReturn": "verified"] as NSDictionary)
                    } catch {
                        reject("AUTH_SESSION_RETURN_PROBE_FAILED", "Synthetic browser return failed.", nil)
                    }
                }
                return
            }
            guard let value = ChatGPTPlanSimulatorFixture.Scenario(rawValue: scenario) else {
                reject("INVALID_FIXTURE_SCENARIO", "Unknown synthetic fixture scenario.", nil)
                return
            }
            do {
                fixtureLock.lock()
                defer { fixtureLock.unlock() }
                if let simulatorFixture {
                    simulatorFixture.select(value)
                } else {
                    simulatorFixture = try ChatGPTPlanSimulatorFixture(scenario: value)
                }
                resolve(["issuedClientID": ChatGPTPlanSimulatorFixture.issuedClientID] as NSDictionary)
            } catch {
                reject("SYNTHETIC_FIXTURE_FAILED", "Synthetic ChatGPT state could not be prepared.", nil)
            }
        }

        @objc(restoreSyntheticAccountForSignIn:rejecter:)
        func restoreSyntheticAccountForSignIn(
            _ resolve: @escaping RCTPromiseResolveBlock,
            rejecter reject: @escaping RCTPromiseRejectBlock,
        ) {
            do {
                fixtureLock.lock()
                defer { fixtureLock.unlock() }
                let fixture: ChatGPTPlanSimulatorFixture
                if let simulatorFixture {
                    fixture = simulatorFixture
                } else {
                    fixture = try ChatGPTPlanSimulatorFixture(scenario: .completed)
                    simulatorFixture = fixture
                }
                try fixture.restoreSyntheticAccountForSignIn()
                resolve(nil)
            } catch {
                reject("SYNTHETIC_FIXTURE_RESTORE_FAILED", "Synthetic ChatGPT sign-in could not be restored.", nil)
            }
        }

        @objc(removeSyntheticFixture:rejecter:)
        func removeSyntheticFixture(
            _ resolve: @escaping RCTPromiseResolveBlock,
            rejecter reject: @escaping RCTPromiseRejectBlock,
        ) {
            fixtureLock.lock()
            let activeFixture = simulatorFixture
            simulatorFixture = nil
            fixtureLock.unlock()
            do {
                if let activeFixture {
                    try activeFixture.remove()
                } else {
                    let persistedFixture = try ChatGPTPlanSimulatorFixture(scenario: .completed)
                    try persistedFixture.remove()
                }
                resolve(nil)
            } catch {
                reject("SYNTHETIC_FIXTURE_CLEANUP_FAILED", "Synthetic ChatGPT state could not be removed.", nil)
            }
        }

        private func restoreSyntheticAccountAfterAuthReturn() throws {
            fixtureLock.lock()
            defer { fixtureLock.unlock() }
            let fixture: ChatGPTPlanSimulatorFixture
            if let simulatorFixture {
                fixture = simulatorFixture
                fixture.select(.completed)
            } else {
                fixture = try ChatGPTPlanSimulatorFixture(scenario: .completed)
                simulatorFixture = fixture
            }
            try fixture.restoreSyntheticAccountForSignIn()
        }
    }
#endif
