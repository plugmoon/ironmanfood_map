'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const fssync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

loadEnvFile(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const LOCATIONS_FILE = path.join(DATA_DIR, 'locations.json');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin12345';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-session-secret-change-me';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const sessions = new Map();

const truthyValues = new Set(['1', 'true', 'yes', 'y', 'on', '是', '有', '支援', '支援外送']);

function loadEnvFile(filePath) {
  if (!fssync.existsSync(filePath)) return;
  const lines = fssync.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const textFields = [
  'station_code',
  'region',
  'name',
  'city',
  'district',
  'address',
  'manager_name',
  'phone',
  'business_hours',
  'map_url'
];

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon'
};

function nowIso() {
  return new Date().toISOString();
}

function hash(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

function constantEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function readCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index === -1) return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function writeJson(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(JSON.stringify(data));
}

function writeText(res, status, body, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function notFound(res) {
  writeJson(res, 404, { error: '找不到資源' });
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function isSecureRequest(req) {
  return req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
}

function setSessionCookie(req, res, token) {
  const secure = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `admin_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
}

function getAdminSession(req) {
  const token = readCookies(req).admin_session;
  if (!token) return null;
  const key = hash(token);
  const session = sessions.get(key);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(key);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function requireAdmin(req, res) {
  const session = getAdminSession(req);
  if (session) return session;
  writeJson(res, 401, { error: '請先登入後台' });
  return null;
}

async function parseJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024 * 3) throw new Error('資料過大');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

async function ensureDataStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  if (!fssync.existsSync(LOCATIONS_FILE)) {
    await fs.writeFile(LOCATIONS_FILE, '[]\n', 'utf8');
  }
}

async function readLocations() {
  await ensureDataStore();
  const raw = await fs.readFile(LOCATIONS_FILE, 'utf8');
  const data = JSON.parse(raw || '[]');
  return Array.isArray(data) ? data : [];
}

async function writeLocations(locations) {
  await ensureDataStore();
  const tempPath = `${LOCATIONS_FILE}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(locations, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, LOCATIONS_FILE);
}

function cleanText(value, maxLength = 255) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanNumber(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanFlag(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value ? 1 : 0;
  return truthyValues.has(String(value ?? '').trim().toLowerCase()) ? 1 : 0;
}

function cleanFlagWithDefault(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return cleanFlag(value);
}

function normalizeLocation(input, existing = {}) {
  const item = {};
  for (const key of textFields) {
    const sourceKey = key === 'map_url' ? input.map_url ?? input.google_map_url : input[key];
    const max = key === 'address' || key === 'map_url' ? 500 : 160;
    item[key] = cleanText(sourceKey, max);
  }

  item.name = cleanText(item.name, 190);
  if (!item.name) throw new Error('商家名稱為必填');

  const lat = cleanNumber(input.lat, null);
  const lng = cleanNumber(input.lng, null);
  if (lat !== null && (lat < -90 || lat > 90)) throw new Error('緯度需介於 -90 到 90');
  if (lng !== null && (lng < -180 || lng > 180)) throw new Error('經度需介於 -180 到 180');

  item.lat = lat;
  item.lng = lng;
  item.support_uber = cleanFlag(input.support_uber ?? input.uber_delivery ?? input.uber);
  item.support_panda = cleanFlag(input.support_panda ?? input.panda_delivery ?? input.foodpanda ?? input['熊貓']);
  item.show_manager = cleanFlagWithDefault(input.show_manager, existing.show_manager ?? 1);
  item.show_phone = cleanFlagWithDefault(input.show_phone, existing.show_phone ?? 1);
  item.status = Number(input.status) === 0 ? 0 : 1;
  item.sort_order = Math.trunc(cleanNumber(input.sort_order, 0) || 0);
  item.id = existing.id;
  item.created_at = existing.created_at || nowIso();
  item.updated_at = nowIso();
  return item;
}

function publicLocation(item) {
  const showManager = cleanFlagWithDefault(item.show_manager, 1);
  const showPhone = cleanFlagWithDefault(item.show_phone, 1);
  return {
    id: item.id,
    station_code: item.station_code,
    region: item.region,
    name: item.name,
    city: item.city,
    district: item.district,
    address: item.address,
    manager_name: showManager ? item.manager_name : '',
    phone: showPhone ? item.phone : '',
    business_hours: item.business_hours,
    support_uber: cleanFlag(item.support_uber),
    support_panda: cleanFlag(item.support_panda),
    show_manager: showManager,
    show_phone: showPhone,
    map_url: item.map_url,
    lat: item.lat,
    lng: item.lng,
    sort_order: item.sort_order
  };
}

function filterAndSort(locations, query, includeInactive = false) {
  const keyword = cleanText(query.get('keyword') || query.get('q') || '').toLowerCase();
  const region = cleanText(query.get('region') || '');
  const city = cleanText(query.get('city') || '');
  const district = cleanText(query.get('district') || '');
  const status = query.get('status');

  return locations
    .filter((item) => includeInactive || item.status === 1)
    .filter((item) => (includeInactive && status !== null ? String(item.status) === status : true))
    .filter((item) => (!region ? true : item.region === region))
    .filter((item) => (!city ? true : item.city === city))
    .filter((item) => (!district ? true : item.district === district))
    .filter((item) => {
      if (!keyword) return true;
      const searchableManager = includeInactive || cleanFlagWithDefault(item.show_manager, 1) ? item.manager_name : '';
      const searchablePhone = includeInactive || cleanFlagWithDefault(item.show_phone, 1) ? item.phone : '';
      return [
        item.station_code,
        item.region,
        item.name,
        item.city,
        item.district,
        item.address,
        searchableManager,
        searchablePhone,
        item.business_hours,
        cleanFlag(item.support_uber) ? 'Uber 外送' : '',
        cleanFlag(item.support_panda) ? '熊貓 外送 Foodpanda' : ''
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    })
    .sort((a, b) => (a.sort_order - b.sort_order) || (b.id - a.id));
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function locationsToCsv(locations) {
  const headers = [
    'station_code',
    'region',
    'name',
    'city',
    'district',
    'address',
    'manager_name',
    'phone',
    'show_manager',
    'show_phone',
    'business_hours',
    'support_uber',
    'support_panda',
    'lat',
    'lng',
    'status',
    'sort_order',
    'map_url'
  ];
  const rows = locations.map((item) => headers.map((key) => csvEscape(item[key])).join(','));
  return `${headers.join(',')}\n${rows.join('\n')}\n`;
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/locations') {
    const locations = await readLocations();
    const rows = filterAndSort(locations, url.searchParams, false).map(publicLocation);
    writeJson(res, 200, rows);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    if (!isSameOrigin(req)) return writeJson(res, 403, { error: '來源驗證失敗' }), true;
    const body = await parseJsonBody(req);
    if (!constantEqual(body.username || '', ADMIN_USERNAME) || !constantEqual(body.password || '', ADMIN_PASSWORD)) {
      return writeJson(res, 401, { error: '帳號或密碼錯誤' }), true;
    }
    const token = crypto.randomBytes(32).toString('base64url');
    sessions.set(hash(token), {
      username: ADMIN_USERNAME,
      expiresAt: Date.now() + SESSION_TTL_MS
    });
    setSessionCookie(req, res, token);
    writeJson(res, 200, { ok: true, username: ADMIN_USERNAME });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    const token = readCookies(req).admin_session;
    if (token) sessions.delete(hash(token));
    clearSessionCookie(res);
    writeJson(res, 200, { ok: true });
    return true;
  }

  if (pathname.startsWith('/api/admin/')) {
    if (req.method !== 'GET' && !isSameOrigin(req)) return writeJson(res, 403, { error: '來源驗證失敗' }), true;
    const session = requireAdmin(req, res);
    if (!session) return true;

    if (req.method === 'GET' && pathname === '/api/admin/me') {
      writeJson(res, 200, { username: session.username });
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/admin/locations') {
      const locations = await readLocations();
      writeJson(res, 200, filterAndSort(locations, url.searchParams, true));
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/admin/locations') {
      const body = await parseJsonBody(req);
      const locations = await readLocations();
      const nextId = locations.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
      const item = normalizeLocation(body, { id: nextId });
      locations.push(item);
      await writeLocations(locations);
      writeJson(res, 201, item);
      return true;
    }

    const locationMatch = pathname.match(/^\/api\/admin\/locations\/(\d+)$/);
    if (locationMatch && req.method === 'PUT') {
      const id = Number(locationMatch[1]);
      const body = await parseJsonBody(req);
      const locations = await readLocations();
      const index = locations.findIndex((item) => Number(item.id) === id);
      if (index === -1) return notFound(res), true;
      const item = normalizeLocation(body, locations[index]);
      locations[index] = item;
      await writeLocations(locations);
      writeJson(res, 200, item);
      return true;
    }

    if (locationMatch && req.method === 'DELETE') {
      const id = Number(locationMatch[1]);
      const locations = await readLocations();
      const next = locations.filter((item) => Number(item.id) !== id);
      if (next.length === locations.length) return notFound(res), true;
      await writeLocations(next);
      writeJson(res, 200, { ok: true });
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/admin/import') {
      const body = await parseJsonBody(req);
      const incoming = Array.isArray(body.locations) ? body.locations : [];
      const mode = body.mode === 'replace' ? 'replace' : 'append';
      const existing = mode === 'replace' ? [] : await readLocations();
      let nextId = existing.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
      const imported = [];
      const errors = [];

      incoming.forEach((row, index) => {
        try {
          imported.push(normalizeLocation(row, { id: nextId++ }));
        } catch (error) {
          errors.push({ row: index + 1, error: error.message });
        }
      });

      await writeLocations([...existing, ...imported]);
      writeJson(res, 200, { imported: imported.length, skipped: errors.length, errors });
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/admin/export.csv') {
      const locations = await readLocations();
      writeText(res, 200, locationsToCsv(locations), 'text/csv; charset=utf-8', {
        'Content-Disposition': 'attachment; filename="locations.csv"'
      });
      return true;
    }
  }

  return false;
}

async function serveStatic(req, res, url) {
  let requestPath = decodeURIComponent(url.pathname);
  if (requestPath === '/') requestPath = '/index.html';
  if (requestPath === '/admin') requestPath = '/admin.html';

  const filePath = path.resolve(PUBLIC_DIR, `.${requestPath}`);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    writeText(res, 403, 'Forbidden');
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return notFound(res);
    const ext = path.extname(filePath).toLowerCase();
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600'
    });
    res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') return notFound(res);
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const handled = await handleApi(req, res, url);
    if (handled) return;
    await serveStatic(req, res, url);
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : 500;
    writeJson(res, status, { error: status === 400 ? 'JSON 格式錯誤' : '伺服器發生錯誤' });
    console.error(error);
  }
});

ensureDataStore()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`Store locator running at http://${HOST}:${PORT}`);
      if (!process.env.ADMIN_PASSWORD) {
        console.warn('Default admin password is admin12345. Set ADMIN_PASSWORD before production deployment.');
      }
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
