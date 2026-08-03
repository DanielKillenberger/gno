/**
 * Shared SQL fragments for the document "effective source path" and its parent
 * directory key.
 *
 * A document's effective source path is `COALESCE(record_source_path, rel_path)`:
 * record-container documents (JSONL/transcript exports) are stored under virtual
 * `#record/...` paths while their physical input lives in `record_source_path`.
 * Any filesystem-facing lookup must use the physical path.
 *
 * The parent expression and the partial index below are deliberately defined in
 * ONE place: migration 026 creates the index from `CREATE_SOURCE_PARENT_INDEX_SQL`
 * and the adapter queries with `ACTIVE_DIRECT_CHILD_SOURCE_PATHS_SQL`, which is
 * built from the same expression strings. SQLite matches expression indexes
 * structurally, so a textual drift between the two would silently degrade the
 * lookup into a full collection scan. `test/store/source-parent-index.test.ts`
 * pins the query plan.
 *
 * @module src/store/source-path-sql
 */

/** Effective (physical) source path of a document row. */
export const SOURCE_PATH_EXPR = "COALESCE(record_source_path, rel_path)";

/**
 * Parent directory of the effective source path, POSIX-style, with the
 * collection root represented as the empty string.
 *
 * `replace(p, '/', '')` yields every character of `p` except the separators, so
 * `rtrim(p, <that>)` strips the trailing final segment and leaves `p` up to and
 * including its last `/`. Dropping that trailing separator gives the parent.
 * A path with no separator is a direct child of the collection root.
 */
export const SOURCE_PARENT_PATH_EXPR = `CASE WHEN instr(${SOURCE_PATH_EXPR}, '/') = 0 THEN '' ELSE substr(${SOURCE_PATH_EXPR}, 1, length(rtrim(${SOURCE_PATH_EXPR}, replace(${SOURCE_PATH_EXPR}, '/', ''))) - 1) END`;

/** Name of the partial expression index backing the direct-children lookup. */
export const SOURCE_PARENT_INDEX_NAME = "idx_documents_source_parent_path";

/**
 * Partial expression index making the active direct-children lookup an equality
 * probe for both the collection root and nested directories. The trailing
 * source-path column keeps `DISTINCT` satisfiable from index order, so SQLite
 * needs no temporary B-tree.
 */
export const CREATE_SOURCE_PARENT_INDEX_SQL = `CREATE INDEX IF NOT EXISTS ${SOURCE_PARENT_INDEX_NAME}
  ON documents(collection, ${SOURCE_PARENT_PATH_EXPR}, ${SOURCE_PATH_EXPR})
  WHERE active = 1`;

/** Drop statement for the parent index (migration rollback). */
export const DROP_SOURCE_PARENT_INDEX_SQL = `DROP INDEX IF EXISTS ${SOURCE_PARENT_INDEX_NAME}`;

/**
 * Distinct effective source paths of ACTIVE documents that are direct children
 * of a given directory in a given collection. Parameters: `collection`,
 * `parentDirRelPath` (`""` for the collection root).
 */
export const ACTIVE_DIRECT_CHILD_SOURCE_PATHS_SQL = `SELECT DISTINCT ${SOURCE_PATH_EXPR} AS source_path
   FROM documents
   WHERE collection = ? AND ${SOURCE_PARENT_PATH_EXPR} = ? AND active = 1`;
