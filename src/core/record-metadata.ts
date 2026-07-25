import type { RecordAnchor, RecordMetadata } from "../converters/types";

export interface RecordEvidenceMetadata extends RecordMetadata {
  recordKey: string;
  sourceLocator: string;
  anchors: RecordAnchor[];
  adapter: {
    id: string;
    version: string;
    fingerprint: string;
  };
}

interface RecordMetadataSource {
  recordKey?: string | null;
  recordSourceLocator?: string | null;
  recordMetadata?: RecordMetadata | null;
  recordAnchors?: RecordAnchor[] | null;
  converterId?: string | null;
  converterVersion?: string | null;
  recordAdapterFingerprint?: string | null;
}

/** Project only bounded, collection-relative logical-record provenance. */
export const projectRecordEvidenceMetadata = (
  source: RecordMetadataSource
): RecordEvidenceMetadata | undefined => {
  if (
    !(
      source.recordKey &&
      source.recordSourceLocator &&
      source.converterId &&
      source.converterVersion &&
      source.recordAdapterFingerprint
    )
  )
    return undefined;
  return {
    recordKey: source.recordKey,
    sourceLocator: source.recordSourceLocator,
    anchors: source.recordAnchors ?? [],
    adapter: {
      id: source.converterId,
      version: source.converterVersion,
      fingerprint: source.recordAdapterFingerprint,
    },
    ...source.recordMetadata,
  };
};
