import ObjectiveC
import UIKit

/// Owns a framework UIView source item; UIKit's activity controller rejects arbitrary protocol conformers.
@MainActor
final class PopoverSourceRegion: NSObject {
    private static var retentionKey: UInt8 = 0
    let item = UIView()

    init(view: UIView, rect: CGRect) {
        super.init()
        item.frame = rect
        item.backgroundColor = .clear
        item.isUserInteractionEnabled = false
        item.isAccessibilityElement = false
        item.accessibilityElementsHidden = true
        view.addSubview(item)
    }

    /// The popover retains the region through presentation after the initiating anchor is released.
    func retain(on popover: UIPopoverPresentationController) {
        objc_setAssociatedObject(popover, &Self.retentionKey, self, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }

    #if OROT_TESTS
        enum ObservationStage: String { case before, after }
        static var testObservations: [[String: Any]] = []

        @available(iOS 17.0, *)
        static func testReadbackObservation(item: UIView, controller: UIActivityViewController, window: UIWindow, foreignWindow: UIWindow, expected: CGRect) -> [String: Any] {
            [
                "itemClass": String(describing: type(of: item)),
                "itemIsExactUIView": type(of: item) == UIView.self,
                "identityPreserved": controller.popoverPresentationController?.sourceItem === item,
                "exactGeometry": item.frame(in: window) == expected,
                "foreignFrameIsNil": item.frame(in: foreignWindow) == nil,
                "modalStyle": controller.modalPresentationStyle.rawValue,
            ]
        }

        /// A flagged UIKit reference observes system behavior independently of the unchanged application acceptance guard.
        @available(iOS 17.0, *)
        static func runTestReference(
            root: UIViewController,
            window: UIWindow,
            activity: UIActivityViewController,
            applyResult: Bool?,
            fileIsLive: @escaping () -> Bool,
            completion: @escaping ([String: Any]) -> Void,
        ) {
            // This isolated fixture has exactly one source region; never guess among unrelated UIKit subviews.
            guard let source = root.viewIfLoaded, source.subviews.count == 1, let candidate = source.subviews.first,
                  window.rootViewController === root, source.window === window, window.isKeyWindow,
                  !window.isHidden, window.alpha > 0,
                  window.windowScene?.activationState == .foregroundActive,
                  type(of: candidate) == UIView.self, candidate.window === window,
                  candidate.frame == CGRect(x: source.bounds.midX, y: source.bounds.midY, width: 1, height: 1)
            else {
                let failure: [String: Any] = ["diagnosticKind": "UIKitReferenceOnly", "referenceSucceeded": false, "fixtureReady": false]
                emitTestReference(failure)
                // A failure may complete only while unpresented; otherwise teardown must dismiss before removing the file.
                guard activity.presentingViewController == nil, activity.viewIfLoaded?.window == nil else { return }
                completion(failure)
                return
            }
            let popover = activity.popoverPresentationController
            let fileWasLive = fileIsLive()
            var observation: [String: Any] = [
                "diagnosticKind": "UIKitReferenceOnly",
                "stage": "beforePresentation",
                "originalApplyResult": applyResult.map { String($0) } ?? "nil",
                "reportedAdaptiveStyleBeforePresentation": popover?.adaptivePresentationStyle(for: activity.traitCollection).rawValue ?? -99,
                "candidateClass": String(describing: type(of: candidate)),
                "candidateAttachedToOriginalSource": candidate.superview === source,
                "candidateSharesWindow": candidate.window === window,
                "candidateRegionInWindow": NSCoder.string(for: candidate.convert(candidate.bounds, to: window)),
                "fileLiveBeforePresentation": fileWasLive,
            ]
            emitTestReference(observation)
            root.present(activity, animated: false) {
                let active = activity.presentationController
                let currentPopover = activity.popoverPresentationController
                let sameWindow = active?.containerView?.window === window && activity.viewIfLoaded?.window === window
                let samePresenter = activity.presentingViewController === root && root.presentedViewController === activity
                let destinationActive = window.isKeyWindow && window.windowScene?.activationState == .foregroundActive && !window.isHidden && window.alpha > 0
                let fileLive = fileIsLive()
                observation["stage"] = "presented"
                observation["activePresentationControllerClass"] = active.map { String(describing: type(of: $0)) } ?? "nil"
                observation["activePresentationStyle"] = active?.presentationStyle.rawValue ?? -99
                observation["reportedAdaptiveStyle"] = active?.adaptivePresentationStyle(for: activity.traitCollection).rawValue ?? -99
                observation["activityModalStyle"] = activity.modalPresentationStyle.rawValue
                observation["horizontalSizeClass"] = activity.traitCollection.horizontalSizeClass.rawValue
                observation["verticalSizeClass"] = activity.traitCollection.verticalSizeClass.rawValue
                observation["activeControllerIsOriginalPopover"] = active === popover
                observation["getterPopoverIsOriginal"] = currentPopover === popover
                observation["getterPopoverIsActiveController"] = currentPopover === active
                observation["actualPresenterClass"] = activity.presentingViewController.map { String(describing: type(of: $0)) } ?? "nil"
                observation["sameInitiatingPresenter"] = samePresenter
                observation["containerAndPresentedViewShareWindow"] = sameWindow
                observation["destinationWindowActive"] = destinationActive
                observation["presenterSharesWindow"] = activity.presentingViewController?.viewIfLoaded?.window === window
                observation["sourceItemIsNil"] = currentPopover?.sourceItem == nil
                observation["sourceItemIsCandidate"] = currentPopover?.sourceItem === candidate
                observation["sourceItemFrameInWindow"] = currentPopover?.sourceItem?.frame(in: window).map { NSCoder.string(for: $0) } ?? "nil"
                observation["sourceViewIsNil"] = currentPopover?.sourceView == nil
                observation["sourceViewIsCandidate"] = currentPopover?.sourceView === candidate
                observation["sourceViewSharesWindow"] = currentPopover?.sourceView?.window === window
                observation["sourceRect"] = currentPopover.map { NSCoder.string(for: $0.sourceRect) } ?? "nil"
                observation["fileLiveWhilePresented"] = fileLive
                emitTestReference(observation)
                activity.dismiss(animated: false) {
                    let dismissed = activity.presentingViewController == nil && activity.viewIfLoaded?.window == nil
                    observation["stage"] = "dismissed"
                    observation["dismissalCompleted"] = dismissed
                    observation["fileLiveAfterDismissal"] = fileIsLive()
                    observation["referenceSucceeded"] = sameWindow && samePresenter && destinationActive && fileWasLive && fileLive && dismissed && fileIsLive()
                    emitTestReference(observation)
                    // The test's callback removes its synthetic export, so a live or unverified modal must never reach it.
                    guard dismissed else { return }
                    completion(observation)
                }
            }
        }

        private static func emitTestReference(_ observation: [String: Any]) {
            if let data = try? JSONSerialization.data(withJSONObject: observation), let text = String(data: data, encoding: .utf8) {
                print("OROT_TEST_UIKIT_REFERENCE \(text)")
            } else {
                print("OROT_TEST_UIKIT_REFERENCE_SERIALIZATION_FAILED")
            }
        }

        /// Capture only UIKit classes, identity comparisons and public geometry; never retain UIKit objects or export URLs.
        @available(iOS 17.0, *)
        func recordTestObservation(
            _ stage: ObservationStage,
            controller: UIViewController,
            popover: UIPopoverPresentationController,
            source: UIView,
            rect: CGRect,
            window: UIWindow,
            current: Bool,
        ) {
            let getterPopover = controller.popoverPresentationController
            let presentation = controller.presentationController
            let returnedItem = popover.sourceItem
            let returnedView = popover.sourceView
            let returnedRect = popover.sourceRect
            let expectedRegion = source.convert(rect, to: window)
            let candidateRegion = item.convert(item.bounds, to: window)
            // This is a diagnostic interpretation, never an acceptance fallback for a missing source item.
            let returnedRegion = returnedView.map { $0.convert(returnedRect.isNull ? $0.bounds : returnedRect, to: window) }
            let observation: [String: Any] = [
                "stage": stage.rawValue,
                "controllerClass": String(describing: type(of: controller)),
                "modalStyle": controller.modalPresentationStyle.rawValue,
                "horizontalSizeClass": controller.traitCollection.horizontalSizeClass.rawValue,
                "verticalSizeClass": controller.traitCollection.verticalSizeClass.rawValue,
                "localPopoverClass": String(describing: type(of: popover)),
                "presentationControllerClass": presentation.map { String(describing: type(of: $0)) } ?? "nil",
                "presentationControllerIsLocal": presentation === popover,
                "getterPopoverClass": getterPopover.map { String(describing: type(of: $0)) } ?? "nil",
                "getterPopoverIsLocal": getterPopover === popover,
                "anchorIsCurrent": current,
                "originalSourceSharesWindow": source.window === window,
                "candidateClass": String(describing: type(of: item)),
                "candidateIsExactUIView": type(of: item) == UIView.self,
                "candidateAttachedToOriginalSource": item.superview === source,
                "candidateSharesWindow": item.window === window,
                "candidateFrameEqualsOriginalRect": item.frame == rect,
                "originalRect": NSCoder.string(for: rect),
                "expectedRegionInWindow": NSCoder.string(for: expectedRegion),
                "candidateBoundsInWindow": NSCoder.string(for: candidateRegion),
                "candidateProtocolFrameInWindow": item.frame(in: window).map { NSCoder.string(for: $0) } ?? "nil",
                "candidateHasExactWindowGeometry": candidateRegion == expectedRegion,
                "sourceItemClass": returnedItem.map { String(describing: type(of: $0)) } ?? "nil",
                "sourceItemIsCandidate": returnedItem === item,
                "sourceItemFrameInWindow": returnedItem?.frame(in: window).map { NSCoder.string(for: $0) } ?? "nil",
                "sourceViewClass": returnedView.map { String(describing: type(of: $0)) } ?? "nil",
                "sourceViewIsCandidate": returnedView === item,
                "sourceViewIsOriginal": returnedView === source,
                "sourceViewSharesWindow": returnedView?.window === window,
                "sourceRect": NSCoder.string(for: returnedRect),
                "sourceRectIsNull": returnedRect.isNull,
                "sourceViewBoundsInWindow": returnedView.map { NSCoder.string(for: $0.convert($0.bounds, to: window)) } ?? "nil",
                "returnedRegionInWindow": returnedRegion.map { NSCoder.string(for: $0) } ?? "nil",
                "returnedRegionHasExactWindowGeometry": returnedRegion == expectedRegion,
            ]
            // Keep diagnostics bounded and emit before the test's assertions can stop attachment creation.
            guard Self.testObservations.count < 8 else { return }
            Self.testObservations.append(observation)
            if let data = try? JSONSerialization.data(withJSONObject: observation), let text = String(data: data, encoding: .utf8) {
                print("OROT_TEST_POPOVER_OBSERVATION \(text)")
            } else {
                print("OROT_TEST_POPOVER_OBSERVATION_SERIALIZATION_FAILED")
            }
        }
    #endif

    deinit {
        // UIKit tears down presentations on the main actor; the source must not retain an orphan region.
        MainActor.assumeIsolated { item.removeFromSuperview() }
    }
}
