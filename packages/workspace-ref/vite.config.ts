import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// AMEND-nexus-spec-workspace-v1-1-1 §1.1, §2.2
// Vite build config for the governed workspace reference UI.
// Builds client bundle to dist/. Server-side stores are NOT bundled here —
// they are imported directly by the API server at runtime.

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
