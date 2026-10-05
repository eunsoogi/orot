import Foundation
import HealthKit
import React

/// Exposes feature-scoped HealthKit requests and queries to the React Native layer.
@objc(HealthKitModule)
public final class HealthKitModule: NSObject {
    let store = HKHealthStore()
    #if DEBUG && targetEnvironment(simulator)
        private let fixtureLock = NSLock()
        private var syntheticFixtureFeature: String?
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
        @objc(prepareSyntheticFixture:resolver:rejecter:)
        public func prepareSyntheticFixture(_ feature: String,
                                            resolver resolve: @escaping RCTPromiseResolveBlock,
                                            rejecter reject: @escaping RCTPromiseRejectBlock)
        {
            guard HealthKitBoundary.isSupported(feature) else {
                reject("UNSUPPORTED_FIXTURE_FEATURE", "Synthetic HealthKit fixture feature is unsupported.", nil)
                return
            }
            fixtureLock.lock()
            syntheticFixtureFeature = feature
            fixtureLock.unlock()
            resolve(["mode": "synthetic"] as NSDictionary)
        }

        @objc(removeSyntheticFixture:rejecter:)
        public func removeSyntheticFixture(_ resolve: @escaping RCTPromiseResolveBlock,
                                           rejecter _: @escaping RCTPromiseRejectBlock)
        {
            fixtureLock.lock()
            syntheticFixtureFeature = nil
            fixtureLock.unlock()
            resolve(nil)
        }

        @objc(inspectReadAuthorizationPlan:resolver:rejecter:)
        public func inspectReadAuthorizationPlan(_ feature: String,
                                                 resolver resolve: @escaping RCTPromiseResolveBlock,
                                                 rejecter _: @escaping RCTPromiseRejectBlock)
        {
            guard HealthKitBoundary.isSupported(feature),
                  let plan = HealthKitBoundary.authorizationPlan(for: feature)
            else {
                resolve(["availability": "unsupportedFeature", "readTypeIdentifiers": [],
                         "writeTypeIdentifiers": []] as NSDictionary)
                return
            }
            resolve([
                "availability": "available",
                "readTypeIdentifiers": plan.readTypes.map(\.identifier).sorted(),
                "writeTypeIdentifiers": plan.shareTypes.map(\.identifier).sorted(),
            ] as NSDictionary)
        }

        @objc(inspectSampleType:sampleKind:resolver:rejecter:)
        public func inspectSampleType(_ feature: String, sampleKind: String,
                                      resolver resolve: @escaping RCTPromiseResolveBlock,
                                      rejecter reject: @escaping RCTPromiseRejectBlock)
        {
            guard let sampleType = HealthKitBoundary.sampleType(feature: feature, kind: sampleKind) else {
                reject("UNSUPPORTED_SAMPLE_KIND", "HealthKit sample kind is unsupported.", nil)
                return
            }
            resolve(sampleType.identifier)
        }

        var hasSyntheticFixture: Bool {
            fixtureLock.lock()
            defer { fixtureLock.unlock() }
            return syntheticFixtureFeature != nil
        }

        func hasSyntheticFixture(for feature: String) -> Bool {
            fixtureLock.lock()
            defer { fixtureLock.unlock() }
            return syntheticFixtureFeature == feature
        }
    #endif
}
