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
  minify: false,
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
