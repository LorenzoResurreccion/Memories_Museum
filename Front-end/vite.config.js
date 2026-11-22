import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import authDemoPlugin from './dev/authDemoPlugin.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    // npm run dev:auth (vite --mode demo): local stand-in for CloudFront + the login
    // Lambda. Dev server only (apply: 'serve'), so it is never part of a build.
    ...(mode === 'demo' ? [authDemoPlugin()] : []),
  ],
}))
