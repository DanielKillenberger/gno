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

/**
 * Directory keys per batched statement.
 *
 * SQLite's `SQLITE_LIMIT_VARIABLE_NUMBER` defaults to 999; one parameter is
 * spent on `collection`. This is a STATEMENT-SHAPE bound, not a work budget:
 * every requested directory is queried, just across more than one statement
 * once there are more than this many of them. Nothing is ever dropped.
 */
export const ACTIVE_DIRECT_CHILD_BATCH_CHUNK = 898;

/**
 * Batched form of the direct-children lookup: the active effective source paths
 * of several directories in one statement, tagged with their parent directory.
 *
 * Two deliberate differences from the single-directory statement above:
 *
 * - `INDEXED BY` pins the plan. Measured on a 800-row/ANALYZE-d database, an
 *   unhinted `IN (...)` list of 26 keys made SQLite prefer
 *   `idx_docs_wiki_relpath_resolve (collection=?)` - still a SEARCH, but a
 *   collection-wide one that reads every active row of the collection. R11
 *   requires the parent index specifically, and a hint is the only way to get
 *   it deterministically at every IN-list size.
 * - No `DISTINCT`. Across several IN values SQLite cannot satisfy `DISTINCT`
 *   from index order alone and adds `USE TEMP B-TREE FOR DISTINCT`, which R11
 *   forbids. The caller dedupes per directory in memory instead - the same
 *   collapse of a record container's many logical rows to one physical source
 *   path (R10), performed one layer up.
 */
export function activeDirectChildSourcePathsBatchSql(dirCount: number): string {
  const placeholders = Array.from({ length: dirCount }, () => "?").join(", ");
  return `SELECT ${SOURCE_PARENT_PATH_EXPR} AS parent_path, ${SOURCE_PATH_EXPR} AS source_path
   FROM documents INDEXED BY ${SOURCE_PARENT_INDEX_NAME}
   WHERE collection = ? AND ${SOURCE_PARENT_PATH_EXPR} IN (${placeholders}) AND active = 1`;
}
