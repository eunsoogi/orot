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
