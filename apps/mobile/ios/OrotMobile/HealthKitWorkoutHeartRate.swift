import Foundation
import HealthKit
import React

extension HealthKitModule {
    /// A local Records action reads one workout. This query never prompts for authorization
    /// or treats heart-rate samples that merely overlap the workout as associated samples.
    @objc(queryWorkoutHeartRate:resolver:rejecter:)
    public func queryWorkoutHeartRate(_ rawID: String,
                                      resolver resolve: @escaping RCTPromiseResolveBlock,
                                      rejecter reject: @escaping RCTPromiseRejectBlock)
    {
        guard let identifier = UUID(uuidString: rawID) else {
            reject("INVALID_REQUEST", "Workout identifier is invalid.", nil)
            return
        }
        #if DEBUG && targetEnvironment(simulator)
            if hasSyntheticFixture {
                resolve(["status": "notAvailable"] as NSDictionary)
                return
            }
        #endif
        guard HKHealthStore.isHealthDataAvailable(),
              let heartRate = HKObjectType.quantityType(forIdentifier: .heartRate) else {
            resolve(["status": "notAvailable"] as NSDictionary)
            return
        }
        let query = HKSampleQuery(
            sampleType: HKObjectType.workoutType(),
            predicate: HKQuery.predicateForObject(with: identifier),
            limit: 1, sortDescriptors: nil,
        ) { [weak self] _, samples, error in
            if error != nil {
                reject("WORKOUT_READ_FAILED", "The selected workout could not be read.", nil)
                return
            }
            guard let self, let workout = samples?.first as? HKWorkout, workout.uuid == identifier else {
                resolve(["status": "notAvailable"] as NSDictionary)
                return
            }
            #if DEBUG && targetEnvironment(simulator)
                if self.hasSyntheticFixture {
                    resolve(["status": "notAvailable"] as NSDictionary)
                    return
                }
            #endif
            self.readAssociatedHeartRate(workout: workout, heartRate: heartRate, resolve: resolve, reject: reject)
        }
        store.execute(query)
    }

    private func readAssociatedHeartRate(workout: HKWorkout, heartRate: HKQuantityType,
                                         resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock)
    {
        // Admit only associated records fully inside the half-open workout window.
        // An endpoint or a condensed record crossing it is not reported as covered.
        let interval = HKQuery.predicateForSamples(
            withStart: workout.startDate, end: workout.endDate,
            options: [.strictStartDate, .strictEndDate],
        )
        let associated = HKQuery.predicateForObjects(from: workout)
        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [associated, interval])
        // HealthKit computes statistics over underlying condensed quantities; do not average
        // HKQuantitySample summaries or graph them as if they were individual measurements.
        let statistics = HKStatisticsQuery(
            quantityType: heartRate, quantitySamplePredicate: predicate,
            options: [.discreteMin, .discreteAverage, .discreteMax],
        ) { _, result, error in
            if let error = error as NSError?,
               error.domain != HKErrorDomain || error.code != HKError.Code.errorNoData.rawValue {
                reject("WORKOUT_HEART_RATE_READ_FAILED", "Associated heart rate could not be read.", nil)
                return
            }
            let unit = HKUnit.count().unitDivided(by: .minute())
            guard let minimum = result?.minimumQuantity()?.doubleValue(for: unit),
                  let mean = result?.averageQuantity()?.doubleValue(for: unit),
                  let maximum = result?.maximumQuantity()?.doubleValue(for: unit) else {
                // Empty cannot distinguish absent measurements from an unobservable read grant.
                resolve(["status": "notAvailable"] as NSDictionary)
                return
            }
            resolve(["status": "available", "minimum": minimum, "mean": mean, "maximum": maximum] as NSDictionary)
        }
        store.execute(statistics)
    }
}
