const net = require('net');

function normalizeIp(raw) {
  if (!raw) return '';
  let ip = String(raw).trim();

  // X-Forwarded-For can contain a comma-separated chain. The first item is
  // the original client.
  if (ip.includes(',')) ip = ip.split(',')[0].trim();

  // Strip IPv6 brackets and scope IDs, e.g. [fe80::1%wlan0].
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'));
  const zoneIndex = ip.indexOf('%');
  if (zoneIndex !== -1) ip = ip.slice(0, zoneIndex);

  // Some Node/proxy combinations report IPv4 clients as IPv4-mapped IPv6.
  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:')) return lower.slice(7);

  // Be tolerant of an accidental IPv4:port value.
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

function isLoopbackAddress(raw) {
  const ip = normalizeIp(raw);
  if (ip === 'localhost' || ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
  const parts = ipv4Parts(ip);
  return Boolean(parts && parts[0] === 127);
}

function isLocalOrLanAddress(raw) {
  const ip = normalizeIp(raw);
  if (!ip) return false;
  if (isLoopbackAddress(ip)) return true;

  const parts = ipv4Parts(ip);
  if (parts) {
    const [a, b] = parts;
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      // Carrier-grade NAT range, commonly used by local VPN / mesh LAN tools.
      (a === 100 && b >= 64 && b <= 127)
    );
  }

  if (net.isIP(ip) === 6) {
    const firstHextet = parseInt(ip.split(':')[0] || '0', 16);
    if (!Number.isFinite(firstHextet)) return false;
    // fc00::/7 unique-local and fe80::/10 link-local.
    return (firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80;
  }

  return false;
}

function headerValue(headers, name) {
  if (!headers) return '';
  const value = headers[name] || headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function getEffectiveClientIp(req) {
  const remoteIp = normalizeIp(
    req?.socket?.remoteAddress || req?.connection?.remoteAddress || req?.ip || ''
  );

  // Trust X-Forwarded-For only from a local proxy (Vite dev/preview proxy).
  // Direct clients must not be able to spoof themselves as LAN clients.
  if (isLoopbackAddress(remoteIp)) {
    const forwarded = normalizeIp(headerValue(req.headers, 'x-forwarded-for'));
    if (forwarded) return forwarded;
  }

  return remoteIp;
}

function createLanOnlyMiddleware({ enabled = true } = {}) {
  return function lanOnlyMiddleware(req, res, next) {
    if (!enabled) return next();

    const clientIp = getEffectiveClientIp(req);
    if (isLocalOrLanAddress(clientIp)) return next();

    const message = 'Access denied: this app only accepts local or LAN clients';
    if (req.path && req.path.startsWith('/api')) {
      return res.status(403).json({ success: false, message, code: 'ERR_LAN_ONLY' });
    }
    return res.status(403).type('text/plain').send(message);
  };
}

module.exports = {
  normalizeIp,
  isLoopbackAddress,
  isLocalOrLanAddress,
  getEffectiveClientIp,
  createLanOnlyMiddleware,
};
