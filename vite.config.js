import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function datasetManifestPlugin() {
  function generate() {
    const dir = path.resolve(__dirname, 'config/datasets');
    const out = path.resolve(__dirname, 'public/datasets/index.json');
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();
    const manifest = files.map((filename) => {
      const data = JSON.parse(fs.readFileSync(path.join(dir, filename), 'utf8'));
      const id = filename.replace(/\.json$/, '');
      return { id, filename, name: data.name || id, data };
    });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
  }

  return {
    name: 'dataset-manifest',
    buildStart() {
      generate();
    },
    configureServer(server) {
      generate();
      server.watcher.on('add', (f) => {
        if (f.includes('config/datasets')) generate();
      });
      server.watcher.on('unlink', (f) => {
        if (f.includes('config/datasets')) generate();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), datasetManifestPlugin()],
  // eslint-disable-next-line no-undef
  base: process.env.VITE_BASE_PATH || '/',
});
