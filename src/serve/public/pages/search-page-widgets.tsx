/**
 * Search-only re-exports of sidebar widgets.
 *
 * Kept as a separate module so DOM tests can mock.module this path without
 * sticky-mock pollution of the real TagFacets / AIModelSelector suites.
 */
export { AIModelSelector } from "../components/AIModelSelector";
export { TagFacets } from "../components/TagFacets";
