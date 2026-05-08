import withMarkdoc from '@markdoc/next.js';

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['md', 'mdoc', 'js', 'jsx', 'ts', 'tsx'],
  reactStrictMode: true,
  // GitHub Pages-friendly: emit a static site under ./out/.
  // Run `pnpm build && pnpm next export` to publish.
  output: process.env.DOCS_STATIC_EXPORT === 'true' ? 'export' : undefined,
  trailingSlash: true,
};

export default withMarkdoc({
  schemaPath: './markdoc',
})(nextConfig);
