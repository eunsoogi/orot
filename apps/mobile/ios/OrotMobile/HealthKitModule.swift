import Foundation
import HealthKit
import React

/// Builds one read-only request from only the selected, supported feature set.
enum HealthKitBatchAuthorization {
    struct Plan {
        let shareTypes: Set<HKSampleType>
        let readTypes: Set<HKObjectType>
        let requestedFeatures: [String]
        let unsupportedFeatures: [String]
    }

    static func plan(for features: [String]) -> Plan? {
        let knownFeatures = ["medications", "bloodPressure", "sleep", "heartRate", "steps", "bodyMass"]
        guard !features.isEmpty,
              Set(features).count == features.count,
              features.allSatisfy(knownFeatures.contains)
        else { return nil }

        var shareTypes = Set<HKSampleType>()
        var readTypes = Set<HKObjectType>()
        var requestedFeatures: [String] = []
        var unsupportedFeatures: [String] = []
        // Keep unsupported selected features visible without blocking supported reads.
        for feature in features {
            guard HealthKitBoundary.isSupported(feature),
                  let featurePlan = HealthKitBoundary.authorizationPlan(for: feature)
            else {
                unsupportedFeatures.append(feature)
                continue
            }
            shareTypes.formUnion(featurePlan.shareTypes)
            readTypes.formUnion(featurePlan.readTypes)
            requestedFeatures.append(feature)
        }
        return Plan(
            shareTypes: shareTypes,
            readTypes: readTypes,
            requestedFeatures: requestedFeatures,
            unsupportedFeatures: unsupportedFeatures,
        )
    }

    static func result(availability: String,
                       status: String,
                       requestedFeatures: [String],
                       unsupportedFeatures: [String]) -> NSDictionary
    {
        [
            "availability": availability,
            "requestStatus": status,
            "readAuthorization": "notObservable",
            "requestedFeatures": requestedFeatures,
            "unsupportedFeatures": unsupportedFeatures,
        ] as NSDictionary
    }
}

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
            reject("UNSUPPORTED_FEATURE", "HealthKit feature is unsupported.", nil)
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

        // Completion confirms request processing, not whether HealthKit granted read access.
        store.requestAuthorization(toShare: plan.shareTypes, read: plan.readTypes) { success, error in
            if let error {
                reject("HEALTHKIT_AUTHORIZATION_FAILED", error.localizedDescription, error as NSError)
                return
            }
            guard success else {
                reject("HEALTHKIT_AUTHORIZATION_FAILED", "HealthKit authorization request did not succeed.", nil)
                return
            }
            resolve(HealthKitBoundary.authorizationResult(availability: "available", status: "completed"))
        }
    }

    @objc(requestReadAuthorizations:resolver:rejecter:)
    public func requestReadAuthorizations(_ features: [String],
                                          resolver resolve: @escaping RCTPromiseResolveBlock,
                                          rejecter reject: @escaping RCTPromiseRejectBlock)
    {
        guard let plan = HealthKitBatchAuthorization.plan(for: features) else {
            reject("INVALID_REQUEST", "HealthKit batch authorization selection is invalid.", nil)
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

        // One completion covers the selected read set; it still cannot reveal read grants.
        store.requestAuthorization(toShare: plan.shareTypes, read: plan.readTypes) { success, error in
            if let error {
                reject("HEALTHKIT_AUTHORIZATION_FAILED", error.localizedDescription, error as NSError)
                return
            }
            guard success else {
                reject("HEALTHKIT_AUTHORIZATION_FAILED", "HealthKit authorization request did not succeed.", nil)
                return
            }
            resolve(HealthKitBatchAuthorization.result(
                availability: "available",
                status: "completed",
                requestedFeatures: plan.requestedFeatures,
                unsupportedFeatures: plan.unsupportedFeatures,
            ))
        }
    }

    @objc(querySamples:resolver:rejecter:)
    public func querySamples(_ request: NSDictionary,
                             resolver resolve: @escaping RCTPromiseResolveBlock,
                             rejecter reject: @escaping RCTPromiseRejectBlock)
    {
        guard let query = HealthKitBoundary.decodeSampleQuery(request) else {
            reject("INVALID_REQUEST", "HealthKit sample query is invalid.", nil)
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
            reject("UNSUPPORTED_SAMPLE_KIND", "HealthKit sample kind is unsupported.", nil)
            return
        }

        let predicate = HKQuery.predicateForSamples(withStart: query.startDate, end: query.endDate, options: [])
        let descriptor = HKQueryDescriptor(sampleType: sampleType, predicate: predicate)
        let nativeQuery = HKSampleQuery(
            queryDescriptors: [descriptor],
            limit: query.limit,
            sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)],
        ) { _, samples, error in
            if let error {
                reject("HEALTHKIT_QUERY_FAILED", error.localizedDescription, error as NSError)
                return
            }
            guard let samples else {
                reject("HEALTHKIT_QUERY_FAILED", "HealthKit returned no query result.", nil)
                return
            }
            // An empty result only means no matching samples are visible to this app.
            do {
                let snapshots = try samples.map(HealthKitBoundary.snapshot)
                resolve(HealthKitBoundary.sampleResult(availability: "available", samples: snapshots))
            } catch {
                reject("HEALTHKIT_SERIALIZATION_FAILED", error.localizedDescription, error as NSError)
            }
        }
        store.execute(nativeQuery)
    }

    #if DEBUG && targetEnvironment(simulator)
        @objc(inspectSampleType:sampleKind:resolver:rejecter:)
        public func inspectSampleType(_ feature: String, sampleKind: String,
                                      resolver resolve: @escaping RCTPromiseResolveBlock,
                                      rejecter reject: @escaping RCTPromiseRejectBlock)
        {
            // This reports the native identifier without querying any HealthKit samples.
            guard let sampleType = HealthKitBoundary.sampleType(feature: feature, kind: sampleKind) else {
                reject("UNSUPPORTED_SAMPLE_KIND", "HealthKit sample kind is unsupported.", nil)
                return
            }
            resolve(sampleType.identifier)
        }
    #endif
}
