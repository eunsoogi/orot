#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE (RootURLModule, RCTEventEmitter)
RCT_EXTERN_METHOD(peek : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(acknowledge : (NSString *)identifier resolver : (RCTPromiseResolveBlock)resolve
                      rejecter : (RCTPromiseRejectBlock)reject)
@end
