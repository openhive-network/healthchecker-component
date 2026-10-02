import react from '@vitejs/plugin-react'
import dts from "vite-plugin-dts";
import { peerDependencies } from "./package.json";
import { defineConfig } from 'vite';

const peers = Object.keys(peerDependencies);

export default defineConfig({
  plugins: [
    react(),
    dts({ insertTypesEntry: true, include: ["src"] }),
  ],
  build: { 
    lib: { 
      entry: {
        component: './src/index.ts'
      },
      name: 'healthchecker-component', 
      fileName: (format) => `healthchecker-component.${format}.js`,
      formats: ['es'],
    }, 
    rollupOptions: { 
      // Subpaths too (react/jsx-runtime, react-dom/client): rollup matches string externals
      // exactly, and a bundled jsx-runtime is tied to the React it came from.
      external: (id) => peers.some((peer) => id === peer || id.startsWith(`${peer}/`)),
      output: { globals: { react: 'React', 'react-dom': 'ReactDOM' } } 
    }
  },
})
