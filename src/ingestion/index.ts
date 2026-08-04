/**
 * Ingestion subsystem - public exports.
 *
 * @module src/ingestion
 */

// Destination safety for paths GNO itself writes into a collection
export type {
  ActiveCaptureDocument,
  ActiveCaptureProof,
  CaptureDestinationErrorCode,
} from "./capture-destination";
export {
  CaptureDestinationError,
  captureProofDocid,
  captureProofSyncReason,
  prepareCaptureDestination,
  requireActiveCaptureDocument,
} from "./capture-destination";
// Chunker
export { defaultChunker, MarkdownChunker } from "./chunker";
// Bounded single-level directory enumeration
export type {
  DirectoryChildrenOutcome,
  VanishedPathOutcome,
} from "./directory-children";
export {
  listEligibleDirectChildren,
  listEligibleSubtreeFiles,
  resolveVanishedPathDirectory,
} from "./directory-children";
// Language detection
export { defaultLanguageDetector, SimpleLanguageDetector } from "./language";
// Sync service
export { defaultSyncService, SyncService } from "./sync";
export { resolveContentTypeRules, withContentTypeRules } from "./sync-options";
// Types
export type {
  ChunkerPort,
  ChunkOutput,
  ChunkParams,
  CollectionSyncResult,
  ContentTypeSource,
  FileSyncResult,
  FileSyncStatus,
  LanguageDetectorPort,
  ProcessDecision,
  SkippedEntry,
  SyncOptions,
  SyncResult,
  WalkConfig,
  WalkEntry,
  WalkerPort,
} from "./types";
export { collectionToWalkConfig, DEFAULT_CHUNK_PARAMS } from "./types";
// Walker
export { defaultWalker, FileWalker, matchesWalkPath } from "./walker";
