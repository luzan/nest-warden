import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'nestjs/index': 'src/nestjs/index.ts',
    'typeorm/index': 'src/typeorm/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  // Minify the published JS (Theme 11A). Drops ~60% off the raw
  // dist/*.js sizes and ~45% off gzipped: dist/index.cjs goes from
  // ~21 KB → ~9 KB raw, ~6.3 KB → ~3.5 KB gzipped. The published
  // tarball drops from ~100 KB → ~90 KB (the bulk of the remaining
  // weight is .d.ts bundles, which are inherently large).
  //
  // No effect on source maps for the example app — `.map` files are
  // generated locally for debugging but excluded from the npm
  // tarball via `"!dist/**/*.map"` in package.json's `files`. So
  // consumers download minified code with no maps; we keep the
  // unminified-with-maps experience locally.
  minify: true,
  target: 'es2022',
  outDir: 'dist',
  external: [
    '@casl/ability',
    '@nestjs/common',
    '@nestjs/core',
    'reflect-metadata',
    'rxjs',
    'typeorm',
  ],
});
