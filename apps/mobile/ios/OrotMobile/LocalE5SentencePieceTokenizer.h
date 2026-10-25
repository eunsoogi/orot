#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface OrotSentencePieceTokenizer : NSObject

- (nullable instancetype)initWithModelPath:(NSString *)modelPath
                                     error:(NSError **)error NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
- (nullable NSArray<NSNumber *> *)encode:(NSString *)text error:(NSError **)error;

@end

NS_ASSUME_NONNULL_END
