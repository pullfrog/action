import { defineConfig } from 'rolldown';

export default defineConfig({
  input: 'index.ts',
  output: {
    file: './index.js',
    format: 'esm'
  },
  platform: 'node',
  target: 'node20',
  external: (id) => {
    // Mark all node modules as external
    return id.includes('node_modules') || id.startsWith('@actions/') || id.startsWith('node:');
  }
});
