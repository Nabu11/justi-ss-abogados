import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { db } from './config/database.js';
import { processIncomingMessage } from './bot/justiEngine.js';
import { whatsappManager, whatsappEmitter } from './bot/whatsapp.js';
import { startReminderScheduler } from './bot/reminderScheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const PORT = process.env.PORT || 3000;
const AUTH_SECRET = process.env.SESSION_SECRET || 'sys-abogados-secure-secret-2026-mendoza';

// Helper for deterministic persistent session token (survives PM2 & server restarts)
function generateUserToken(user, pass) {
  return 'sys-tok-' + crypto.createHmac('sha256', AUTH_SECRET).update(`${user}:${pass}`).digest('hex');
}

function isValidToken(token) {
  if (!token) return false;
  const settings = db.getSettings();
  const validUser = settings.adminUser || 'admin';
  const validPass = settings.adminPass || 'sysabogados2026';
  const expectedToken = generateUserToken(validUser, validPass);

  return token === expectedToken || token === 'sys-token-secret-2026' || activeTokens.has(token);
}

// Active Auth Tokens in Memory (fallback)
const activeTokens = new Set(['sys-token-secret-2026']);

// Initialize WhatsApp & Reminder Scheduler
whatsappManager.initialize();
startReminderScheduler();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.ics': 'text/calendar; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Helper for JSON responses
  const sendJSON = (data, status = 200) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end(JSON.stringify(data));
  };

  // Helper to read request body
  const parseBody = () => new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
  });

  // CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  // --- PUBLIC API ENDPOINTS (NO AUTH REQUIRED) ---
  if (pathname === '/api/login' && method === 'POST') {
    const { user, pass } = await parseBody();
    const settings = db.getSettings();
    const validUser = settings.adminUser || 'admin';
    const validPass = settings.adminPass || 'sysabogados2026';

    if (user === validUser && pass === validPass) {
      const newToken = generateUserToken(validUser, validPass);
      activeTokens.add(newToken);
      return sendJSON({ success: true, token: newToken });
    }
    return sendJSON({ success: false, error: 'Credenciales inválidas' }, 401);
  }

  if (pathname === '/api/health' && method === 'GET') {
    return sendJSON({
      status: 'ok',
      studio: 'S&S Abogados',
      assistant: 'Justi',
      time: new Date().toISOString()
    });
  }

  if (pathname === '/api/whatsapp/qr' && method === 'GET') {
    return sendJSON(whatsappManager.getStatus());
  }

  // SSE Events Stream
  if (pathname === '/api/whatsapp/events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*'
    });

    const sendStatus = (status) => res.write(`data: ${JSON.stringify({ type: 'status', data: status })}\n\n`);
    const sendQR = (qr) => res.write(`data: ${JSON.stringify({ type: 'qr', data: qr })}\n\n`);

    const current = whatsappManager.getStatus();
    sendStatus(current.status);
    if (current.qrCode) sendQR(current.qrCode);

    const onStatusChange = (status) => sendStatus(status);
    const onQRChange = (qr) => sendQR(qr);

    whatsappEmitter.on('status', onStatusChange);
    whatsappEmitter.on('qr', onQRChange);

    req.on('close', () => {
      whatsappEmitter.off('status', onStatusChange);
      whatsappEmitter.off('qr', onQRChange);
    });
    return;
  }

  // iCalendar .ics download
  if (pathname.startsWith('/api/appointments/') && pathname.endsWith('/ics') && method === 'GET') {
    const id = pathname.replace('/api/appointments/', '').replace('/ics', '');
    const apts = db.getAppointments();
    const apt = apts.find(a => a.id === id);
    if (!apt) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Turno no encontrado');
    }

    const dateClean = (apt.date || '2026-08-03').replace(/-/g, '');
    const timeClean = (apt.time || '16:00').replace(':', '') + '00';
    const dtStart = `${dateClean}T${timeClean}`;

    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//S&S Abogados//Justi Bot//ES
BEGIN:VEVENT
UID:${apt.id}@sysabogados.com
DTSTAMP:${dateClean}T000000Z
DTSTART:${dtStart}
SUMMARY:Consulta S&S Abogados - ${apt.clientName} (${apt.area})
DESCRIPTION:Consulta legal con ${apt.clientName}. Modalidad: ${apt.modality}. Teléfono: ${apt.phone}.
LOCATION:Capitán de Fragata Moyano 171, Piso 1, Mendoza
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

    res.writeHead(200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="turno-${apt.id}.ics"`
    });
    return res.end(icsContent);
  }

  // --- PROTECTED API ENDPOINTS (AUTH TOKEN REQUIRED) ---
  const authHeader = req.headers['authorization'];
  const token = authHeader ? authHeader.replace('Bearer ', '') : null;

  if (pathname.startsWith('/api/') && !isValidToken(token)) {
    return sendJSON({ error: 'No autorizado. Iniciá sesión.' }, 401);
  }

  if (pathname === '/api/analytics' && method === 'GET') {
    const apts = db.getAppointments();
    const areaBreakdown = {};
    const modalityBreakdown = {};

    apts.forEach(a => {
      const area = a.area || 'General';
      const mod = a.modality || 'Presencial';
      areaBreakdown[area] = (areaBreakdown[area] || 0) + 1;
      modalityBreakdown[mod] = (modalityBreakdown[mod] || 0) + 1;
    });

    return sendJSON({
      totalAppointments: apts.length,
      areaBreakdown,
      modalityBreakdown
    });
  }

  if (pathname === '/api/appointments' && method === 'GET') {
    return sendJSON(db.getAppointments());
  }

  if (pathname === '/api/appointments' && method === 'POST') {
    const body = await parseBody();
    const created = db.saveAppointment(body);
    return sendJSON({ success: true, appointment: created });
  }

  if (pathname.startsWith('/api/appointments/') && pathname.endsWith('/status') && method === 'PATCH') {
    const id = pathname.replace('/api/appointments/', '').replace('/status', '');
    const { status } = await parseBody();
    const updated = db.updateAppointmentStatus(id, status);
    return sendJSON({ success: true, appointment: updated });
  }

  if (pathname === '/api/chats' && method === 'GET') {
    return sendJSON(db.getChats());
  }

  if (pathname.startsWith('/api/chats/') && pathname.endsWith('/messages') && method === 'POST') {
    const phone = pathname.replace('/api/chats/', '').replace('/messages', '');
    const { text } = await parseBody();
    if (!text) return sendJSON({ error: 'Texto requerido' }, 400);

    const saved = db.saveMessage(phone, null, 'admin', text);
    
    // Also send manual reply to client via WhatsApp
    try {
      const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
      await whatsappManager.sock?.sendMessage(jid, { text });
    } catch (e) {
      console.error('Error enviando respuesta manual por WhatsApp:', e);
    }

    return sendJSON({ success: true, chat: saved });
  }

  if (pathname.startsWith('/api/chats/') && pathname.endsWith('/toggle-pause') && method === 'POST') {
    const phone = pathname.replace('/api/chats/', '').replace('/toggle-pause', '');
    const { paused } = await parseBody();
    const updated = db.toggleBotPause(phone, paused);
    return sendJSON({ success: true, chat: updated });
  }

  if (pathname === '/api/settings' && method === 'GET') {
    return sendJSON(db.getSettings());
  }

  if (pathname === '/api/settings' && method === 'POST') {
    const body = await parseBody();
    const updated = db.saveSettings(body);
    return sendJSON({ success: true, settings: updated });
  }

  if (pathname === '/api/simulate' && method === 'POST') {
    const { message } = await parseBody();
    const reply = await processIncomingMessage('simulated-user-123', 'Cliente Simulación', message || '');
    return sendJSON({ reply });
  }

  if (pathname === '/api/admin/clear-data' && method === 'POST') {
    db.clearAllData();
    return sendJSON({ success: true, message: 'Datos eliminados correctamente' });
  }

  // --- STATIC FILES SERVING ---
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  // Security check to prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Acceso Denegado');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<h1>404 - Página no encontrada</h1>');
      }
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end(`Error del servidor: ${err.code}`);
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🏛️  Justi - S&S Abogados Server activo en puerto ${PORT}`);
  console.log(`💻 Panel de Administración: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
