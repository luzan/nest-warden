# nest-warden — Documentation Site

Markdoc + Next.js docs site for the [`nest-warden`](https://github.com/luzan/nest-warden)
library. Authored entirely in Markdown (`.md`) under `pages/docs/`,
with a few custom Markdoc tags (`{% callout %}`, `{% tabs %}`)
defined in `markdoc/`.

## Local development

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

The dev server has hot reload — edit any `.md` file in `pages/` and
the page reloads automatically.

## Build

```bash
pnpm build        # production-build for SSR/ISR deployment
pnpm start        # serve the production build
```

For static export (GitHub Pages, Netlify, S3, etc.):

```bash
DOCS_STATIC_EXPORT=true pnpm build
# Output goes to ./out/ as plain HTML/CSS/JS
```

## Authoring conventions

- Each page is a `.md` file under `pages/docs/<section>/<slug>.md`.
- Frontmatter (`---` block at top) sets the page title — the layout
  renders it as the H1.
- Standard Markdown works as-is. For richer content, use the custom
  Markdoc tags below.

### Available tags

```mdoc
{% callout type="note" title="Optional title" %}
Note body. Types: note (default), warning, tip, danger.
{% /callout %}

{% tabs %}
{% tab label="pnpm" %}
```bash
pnpm add nest-warden
```
{% /tab %}
{% tab label="npm" %}
```bash
npm install nest-warden
```
{% /tab %}
{% /tabs %}
```

### Adding a new page

1. Create the file: `pages/docs/<section>/<slug>.md`.
2. Add the title via frontmatter.
3. Add it to the sidebar in `components/sidebar.config.ts`.

The next dev-server reload picks it up.

## Where each section lives

| Section | Folder |
|---|---|
| Get Started | `pages/docs/get-started/` |
| Core Concepts | `pages/docs/core-concepts/` |
| Integration Guides | `pages/docs/integration/` |
| Advanced Concepts | `pages/docs/advanced/` |
| API Reference | `pages/docs/api/` |
