# Excise legacy website/ Jekyll site

## Problem

The in-repo `website/` Jekyll site is retired. The hosted site lives in the
separate `gno.sh` repo (`~/work/gno.sh`, deployed from heimdall). But the
legacy folder still looks like a doc surface, so agents keep updating it
(2026-08-30: a docs audit updated `website/_data/features.yml` and a YAML
syntax slip there broke `oxfmt --check` on the CI matrix). User: "are you
updating the website folder here that isn't even gno.sh anymore?"

## Still-live consumers (must keep working)

- `.github/workflows/og-images.yml` generates OG PNGs from
  `website/assets/images/og/` HTML templates (`bun scripts/og-screenshots.ts`).
  OG images are referenced by README/social cards.
- `scripts/sync-assets.ts` syncs `assets/screenshots/` and hero assets into
  `website/assets/`.
- `package.json` `website:*` scripts (`website:og`, `website:sync-assets`,
  `website:install|dev|build|demos`, `website:sync-docs` if present).

## Fix

Decide the target layout and excise the dead parts:

1. Move OG templates (and anything og-images.yml consumes) out of `website/`
   to a neutral home (e.g. `assets/og-templates/`), update
   `scripts/og-screenshots.ts`, `scripts/sync-assets.ts`, and
   `og-images.yml` paths.
2. Delete the Jekyll site (pages, `_layouts`, `_includes`, `_config.yml`,
   `_data/`, demos build if unused) and the now-dead `website:*` scripts.
3. Remove `website/CLAUDE.md` / `website/AGENTS.md` and any root-guidance
   references to the legacy site (root AGENTS.md already marks it legacy).
4. Verify: `bun run lint:check`, `bun test`, and a manual `bun run website:og`
   equivalent from the new template location; og-images.yml workflow runs
   green on a template touch.

## Boundaries

- The `gno.sh` repo is untouched by this spec.
- OG image generation must keep working (CI PR flow unchanged).

## Resolution (2026-08-30)

User decision: keep `website/` in place for historical reference and never
update it again. No excision. Root AGENTS.md now carries the never-update
rule; the OG/asset pipeline keeps consuming `website/assets/` unchanged.
Closed without tasks.
