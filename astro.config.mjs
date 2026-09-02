// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [tailwindcss()]
  },

  // The adapter emits ONE serverless function for every route (_render.func),
  // so a per-file `functions` pattern in vercel.json matches nothing and fails
  // the build with "doesn't match any Serverless Functions". Duration belongs
  // here instead.
  //
  // 300s, not 60: a full run is 200 iterations x 5 operations x 2 engines. At
  // the measured ~110 ms for Firestore and ~52 ms for MongoDB that is roughly
  // 162 seconds, so a 60s cap would truncate it to a third and report a run
  // that never finished.
  adapter: vercel({
    maxDuration: 300
  })
});
