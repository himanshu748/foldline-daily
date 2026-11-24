import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { devvit } from '@devvit/start/vite';

export default defineConfig({
  // Client source maps (~4 MB) are served publicly as WebView assets and slow uploads.
  plugins: [react(), devvit({ client: { build: { sourcemap: false } } })],
});
