import react from '@vitejs/plugin-react'
import dts from "vite-plugin-dts";
import { peerDependencies } from "./package.json";
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    dts({ insertTypesEntry: true }),
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
      external: [...Object.keys(peerDependencies), 
        "@hiveio/wax" // Add this for proper build - vite does not detect hiveio/wax from peerDependencies
      ],
      output: { globals: { react: 'React', 'react-dom': 'ReactDOM' } } 
    }
  },
})
