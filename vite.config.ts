import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          socket: ['socket.io-client'],
        },
      },
    },
  },
  server: {
    // Listen on all interfaces so ngrok / LAN can reach the dev server
    host: true,
    port: 5173,
    strictPort: true,
    // Allow any Host header (ngrok URLs change each run)
    allowedHosts: true,
    proxy: {
      // Keep target on 127.0.0.1 (same machine). Using "localhost"
      // can flip to IPv6 (::1) and break the Socket.IO proxy with EPIPE/ECONNRESET.
      '/api': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
        secure: false,
      },
      '/uploads': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
