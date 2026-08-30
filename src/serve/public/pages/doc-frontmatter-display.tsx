/**
 * DocView-only re-export of FrontmatterDisplay.
 *
 * Kept as a separate module so DOM tests can mock.module this path without
 * sticky-mock pollution of the real FrontmatterDisplay suite.
 */
export {
  FrontmatterDisplay,
  parseFrontmatter,
} from "../components/FrontmatterDisplay";
