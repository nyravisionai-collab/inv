import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

/**
 * Service workers (and therefore the PWA "Install app" prompt) only run in a
 * secure context: https://, or http://localhost. A phone opening the app at
 * its LAN IP over plain HTTP will never see beforeinstallprompt even though
 * the manifest and service worker are both correct. Set HTTPS=1 (see
 * scripts/generate-cert.sh) to serve the dev/preview server over a
 * self-signed cert so LAN devices can install it too.
 */
function loadHttpsOptions() {
  if (String(process.env.HTTPS || '').trim() !== '1') return undefined;
  const certDir = path.join(__dirname, '../certs');
  const keyFile = path.join(certDir, 'dev.key');
  const certFile = path.join(certDir, 'dev.crt');
  if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) {
    console.warn(
      '[https] HTTPS=1 was set but certs/dev.key or certs/dev.crt is missing.\n' +
      '         Run "bash scripts/generate-cert.sh" first. Falling back to HTTP.'
    );
    return undefined;
  }
  return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
}

const httpsOptions = loadHttpsOptions();

function normalizeIp(raw) {
  if (!raw) return '';
  let ip = String(raw).trim();
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'));
  const zoneIndex = ip.indexOf('%');
  if (zoneIndex !== -1) ip = ip.slice(0, zoneIndex);

  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:')) return lower.slice(7);

  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) {
    ip = ip.slice(0, ip.lastIndexOf(':'));
  }

  return ip.toLowerCase();
}

function ipv4Parts(ip) {
  const normalized = normalizeIp(ip);
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) return null;
  const parts = normalized.split('.').map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts;
}

function isLocalOrLanAddress(raw) {
  const ip = normalizeIp(raw);
  if (!ip) return false;
  if (ip === 'localhost' || ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;

  const parts = ipv4Parts(ip);
  if (parts) {
    const [a, b] = parts;
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }

  const firstHextet = parseInt(ip.split(':')[0] || '0', 16);
  if (!Number.isFinite(firstHextet)) return false;
  return (firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80;
}

function lanOnlyEnabled() {
  const value = String(process.env.LAN_ONLY ?? '1').trim().toLowerCase();
  return value !== '0' && value !== 'false' && value !== 'no';
}

function lanOnlyGuard(req, res, next) {
  if (!lanOnlyEnabled() || isLocalOrLanAddress(req.socket?.remoteAddress)) return next();

  res.statusCode = 403;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Access denied: this app only accepts local or LAN clients');
}

function lanOnlyAccessPlugin() {
  return {
    name: 'lan-only-access-guard',
    configureServer(server) {
      server.middlewares.use(lanOnlyGuard);
    },
    configurePreviewServer(server) {
      server.middlewares.use(lanOnlyGuard);
    },
  };
}

const localProxy = {
  target: 'http://127.0.0.1:5000',
  changeOrigin: true,
  secure: false,
  xfwd: true,
};

export default defineConfig({
  plugins: [lanOnlyAccessPlugin(), react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    https: httpsOptions,
    proxy: {
      '/api': localProxy,
      '/uploads': localProxy,
      // So the lite client is reachable as http://<lan-ip>:5173/lite too
      '/lite': localProxy,
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    https: httpsOptions,
    proxy: {
      '/api': localProxy,
      '/uploads': localProxy,
      '/lite': localProxy,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    target: 'es2019',
  },
  // Termux / low-memory friendly
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2019',
    },
  },
});
