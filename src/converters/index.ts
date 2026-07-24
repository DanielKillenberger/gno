/**
 * Converter subsystem public API.
 *
 * Usage:
 *   import { getDefaultPipeline } from './converters';
 *   const pipeline = getDefaultPipeline();
 *   const result = await pipeline.convert(input);
 */

// Canonicalization
export { canonicalize, mirrorHash } from "./canonicalize";
// Errors
export {
  adapterError,
  convertError,
  corruptError,
  isRetryable,
  timeoutError,
  tooLargeError,
  unsupportedError,
} from "./errors";
// MIME detection
export type { MimeDetection, MimeDetector } from "./mime";
export {
  DefaultMimeDetector,
  getDefaultMimeDetector,
  isSupportedExtension,
  SUPPORTED_EXTENSIONS,
} from "./mime";
// Pipeline (main entry point)
export {
  ConversionPipeline,
  getDefaultPipeline,
  resetDefaultPipeline,
} from "./pipeline";
// Registry
export { ConverterRegistry, createDefaultRegistry } from "./registry";
// Types
export type {
  ConversionArtifact,
  ConvertError,
  ConvertErrorCode,
  Converter,
  ConverterId,
  ConvertInput,
  ConvertOutput,
  ConvertResult,
  ConvertWarning,
  PipelineResult,
  RecordAdapter,
  RecordAdapterEvent,
  RecordAdapterFailure,
  RecordAdapterFailureCode,
  RecordAdapterInput,
  RecordAdapterLimits,
  RecordAdapterRecord,
  RecordAnchor,
  RecordAttachmentInventoryItem,
  RecordMetadata,
} from "./types";
export { DEFAULT_LIMITS, DEFAULT_RECORD_ADAPTER_LIMITS } from "./types";
