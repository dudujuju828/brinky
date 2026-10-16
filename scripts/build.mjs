import { build } from 'esbuild';
await build({
  entryPoints: ['vendor/siwc-local/src/index.ts'],
  outfile: 'app/chatgpt-runtime.mjs', bundle: true,
  platform: 'node', target: 'node22', format: 'esm',
  packages: 'external', sourcemap: false,
});
console.log('Brinky ChatGPT runtime built.');
