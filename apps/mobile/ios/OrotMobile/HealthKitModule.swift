import Foundation
import HealthKit
import React

/// Exposes feature-scoped HealthKit requests and queries to the React Native layer.
@objc(HealthKitModule)
public final class HealthKitModule: NSObject {
    let store = HKHealthStore()
    #if DEBUG && targetEnvironment(simulator)
        // The probe selection is isolated to Simulator builds and protects real HealthKit data.
        let fixtureLock = NSLock()
        var syntheticFixtureFeatures = Set<String>()
    #endif

    @objc(getAvailability:rejecter:)
    public func getAvailability(_ resolve: @escaping RCTPromiseResolveBlock,
                                rejecter _: @escaping RCTPromiseRejectBlock)
    {
        resolve(["status": HKHealthStore.isHealthDataAvailable() ? "available" : "unavailable"] as NSDictionary)
    }

    @objc(requestReadAuthorization:resolver:rejecter:)
    public func requestReadAuthorization(_ feature: String,
                                         resolver resolve: @escaping RCTPromiseResolveBlock,
                                         rejecter reject: @escaping RCTPromiseRejectBlock)
    {
        guard HealthKitBoundary.isSupported(feature) else {
            resolve(HealthKitBoundary.authorizationResult(availability: "unsupportedFeature", status: "notRequested"))
            return
        }
        guard let plan = HealthKitBoundary.authorizationPlan(for: feature) else {
            reject("UNSUPPORTED_FEATURE", "Selected health record type is not supported.", nil)
            return
        }

        #if DEBUG && targetEnvironment(simulator)
            if hasSyntheticFixture(for: feature) {
                resolve(HealthKitBoundary.authorizationResult(availability: "available", status: "completed"))
                return
            }
        #endif

        guard HKHealthStore.isHealthDataAvailable() else {
            resolve(HealthKitBoundary.authorizationResult(availability: "unavailable", status: "notRequested"))
            return
        }

        // A successful completion means the request finished; HealthKit keeps read grants unobservable.
        HealthKitReadAuthorization.request(store: store, readTypes: plan.readTypes, perObjectReadTypes: plan.perObjectReadTypes) { result in
            switch result {
            case .success:
                resolve(HealthKitBoundary.authorizationResult(availability: "available", status: "completed"))
            case let .failure(failure):
                reject(failure.bridgeCode, failure.bridgeMessage, NSError(
                    domain: "HealthKitAuthorization",
                    code: 1,
                    userInfo: [
                        NSLocalizedDescriptionKey: failure.bridgeMessage,
                        "stage": failure.stage,
                        "authorizationCode": failure.code,
                    ],
                ))
            }
        }
    }

    @objc(requestReadAuthorizations:resolver:rejecter:)
    public func requestReadAuthorizations(_ features: [String],
                                          resolver resolve: @escaping RCTPromiseResolveBlock,
                                          rejecter reject: @escaping RCTPromiseRejectBlock)
    {
        guard let plan = HealthKitBatchAuthorization.plan(for: features) else {
            reject("INVALID_REQUEST", "Health record permission selection is invalid.", nil)
            return
        }
        guard !plan.requestedFeatures.isEmpty else {
            resolve(HealthKitBatchAuthorization.result(
                availability: "unsupportedFeature",
                status: "notRequested",
                requestedFeatures: [],
                unsupportedFeatures: plan.unsupportedFeatures,
            ))
            return
        }

        #if DEBUG && targetEnvironment(simulator)
            if hasSyntheticFixtures(for: plan.requestedFeatures) {
                resolve(HealthKitBatchAuthorization.result(
                    availability: "available",
                    status: "completed",
                    requestedFeatures: plan.requestedFeatures,
                    unsupportedFeatures: plan.unsupportedFeatures,
                ))
                return
            }
        #endif

        guard HKHealthStore.isHealthDataAvailable() else {
            resolve(HealthKitBatchAuthorization.result(
                availability: "unavailable",
                status: "notRequested",
                requestedFeatures: [],
                unsupportedFeatures: [],
            ))
            return
        }

        // The bridge returns only selected types and request completion, never individual read grants.
        HealthKitReadAuthorization.request(store: store, readTypes: plan.readTypes, perObjectReadTypes: plan.perObjectReadTypes) { result in
            switch result {
            case .success:
                resolve(HealthKitBatchAuthorization.result(
                    availability: "available",
                    status: "completed",
                    requestedFeatures: plan.requestedFeatures,
                    unsupportedFeatures: plan.unsupportedFeatures,
                ))
            case let .failure(failure):
                reject(failure.bridgeCode, failure.bridgeMessage, NSError(
                    domain: "HealthKitAuthorization",
                    code: 1,
                    userInfo: [
                        NSLocalizedDescriptionKey: failure.bridgeMessage,
                        "stage": failure.stage,
                        "authorizationCode": failure.code,
                    ],
                ))
            }
        }
    }

    @objc(querySamples:resolver:rejecter:)
    public func querySamples(_ request: NSDictionary,
                             resolver resolve: @escaping RCTPromiseResolveBlock,
                             rejecter reject: @escaping RCTPromiseRejectBlock)
    {
        guard let query = HealthKitBoundary.decodeSampleQuery(request) else {
            reject("INVALID_REQUEST", "Health record request is invalid.", nil)
            return
        }
        guard HealthKitBoundary.isSupported(query.feature) else {
            resolve(HealthKitBoundary.sampleResult(availability: "unsupportedFeature", samples: nil))
            return
        }
        #if DEBUG && targetEnvironment(simulator)
            if hasSyntheticFixture {
                let samples = HealthKitSimulatorFixture.samples(for: query)
                resolve(HealthKitBoundary.sampleResult(availability: "available", samples: samples))
                return
            }
        #endif
        guard HKHealthStore.isHealthDataAvailable() else {
            resolve(HealthKitBoundary.sampleResult(availability: "unavailable", samples: nil))
            return
        }
        guard let sampleType = HealthKitBoundary.sampleType(feature: query.feature, kind: query.sampleKind) else {
            reject("UNSUPPORTED_SAMPLE_KIND", "Selected health record type is not supported.", nil)
            return
        }

        let predicate = HKQuery.predicateForSamples(withStart: query.startDate, end: query.endDate, options: [])
        // Only stable codes and generic bridge messages cross into the app; provider descriptions can contain private details.
        withMedicationDoseScope(feature: query.feature, predicate: predicate) { scoped in
            guard case let .success(scope) = scoped else {
                if case .failure = scoped {
                    reject("HEALTHKIT_QUERY_FAILED", "Health record query failed.", nil)
                }
                return
            }
            let descriptor = HKQueryDescriptor(sampleType: sampleType, predicate: scope.predicate)
            let nativeQuery = HKSampleQuery(
                queryDescriptors: [descriptor],
                limit: query.limit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)],
            ) { _, samples, error in
                if error != nil {
                    reject("HEALTHKIT_QUERY_FAILED", "Health record query failed.", nil)
                    return
                }
                guard let samples else {
                    reject("HEALTHKIT_QUERY_FAILED", "No health record results were returned.", nil)
                    return
                }
                // An empty result only means no matching samples are visible to this app.
                do {
                    let snapshots = try samples.map(HealthKitBoundary.snapshot)
                    resolve(HealthKitBoundary.sampleResult(availability: "available", samples: snapshots))
                } catch {
                    reject("HEALTHKIT_SERIALIZATION_FAILED", "Health record data could not be processed.", nil)
                }
            }
            self.store.execute(nativeQuery)
        }
    }

    #if DEBUG && targetEnvironment(simulator)
        @objc(inspectSampleType:sampleKind:resolver:rejecter:)
        public func inspectSampleType(_ feature: String, sampleKind: String,
                                      resolver resolve: @escaping RCTPromiseResolveBlock,
                                      rejecter reject: @escaping RCTPromiseRejectBlock)
        {
            // This reports the native identifier without querying any HealthKit samples.
            guard let sampleType = HealthKitBoundary.sampleType(feature: feature, kind: sampleKind) else {
                reject("UNSUPPORTED_SAMPLE_KIND", "Selected health record type is not supported.", nil)
                return
            }
            resolve(sampleType.identifier)
        }
    #endif
}
