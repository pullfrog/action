import { build } from 'esbuild';

await build({
  entryPoints: ['./index.ts'],
  bundle: true,
  outfile: './index.cjs',
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  minify: false,
  sourcemap: false,
});

console.log('✅ Build completed successfully!');
