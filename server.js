import http from 'http';
import fs from 'fs';
import path from 'path';
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

// Active Auth Tokens in Memory
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
      const newToken = 'sys-token-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
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

  // SSE Events Stream
  if (pathname === '/api/whatsapp/events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
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

  if (pathname.startsWith('/api/') && (!token || !activeTokens.has(token))) {
    return sendJSON({ error: 'No autorizado. Iniciá sesión.' }, 401);
  }

  if (pathname === '/api/analytics' && method === 'GET') {
    const apts = db.getAppointments();
    const chats = db.getChats();

    const areaCounts = {};
    const modalityCounts = { Presencial: 0, Videollamada: 0 };
    let urgentCount = 0;

    apts.forEach(a => {
      areaCounts[a.area] = (areaCounts[a.area] || 0) + 1;
      if (a.modality) modalityCounts[a.modality] = (modalityCounts[a.modality] || 0) + 1;
      if (a.isUrgent) urgentCount++;
    });

    return sendJSON({
      totalAppointments: apts.length,
      totalChats: chats.length,
      urgentCount,
      areaBreakdown: areaCounts,
      modalityBreakdown: modalityCounts
    });
  }

  if (pathname === '/api/settings') {
    if (method === 'GET') {
      return sendJSON(db.getSettings());
    } else if (method === 'POST') {
      const body = await parseBody();
      const updated = db.saveSettings(body);
      return sendJSON({ success: true, settings: updated });
    }
  }

  if (pathname === '/api/admin/clear-data' && method === 'POST') {
    db.clearAllData();
    return sendJSON({ success: true, message: 'Todos los datos eliminados correctamente' });
  }

  if (pathname === '/api/appointments') {
    if (method === 'GET') {
      return sendJSON(db.getAppointments());
    } else if (method === 'POST') {
      const body = await parseBody();
      const apt = db.saveAppointment(body);
      return sendJSON({ success: true, appointment: apt });
    }
  }

  if (pathname.startsWith('/api/appointments/') && pathname.endsWith('/status') && method === 'PATCH') {
    const id = pathname.replace('/api/appointments/', '').replace('/status', '');
    const body = await parseBody();
    const updated = db.updateAppointmentStatus(id, body.status);
    if (!updated) return sendJSON({ error: 'Turno no encontrado' }, 404);
    return sendJSON({ success: true, appointment: updated });
  }

  if (pathname === '/api/chats' && method === 'GET') {
    return sendJSON(db.getChats());
  }

  if (pathname.startsWith('/api/chats/')) {
    const parts = pathname.split('/');
    const phone = parts[3];

    if (parts.length === 4 && method === 'GET') {
      const chat = db.getChat(phone);
      if (!chat) return sendJSON({ error: 'Chat no encontrado' }, 404);
      return sendJSON(chat);
    }

    if (parts[4] === 'messages' && method === 'POST') {
      const body = await parseBody();
      if (!body.text) return sendJSON({ error: 'El mensaje no puede estar vacío' }, 400);
      const updatedChat = db.saveMessage(phone, 'Cliente', 'admin', body.text);
      return sendJSON({ success: true, chat: updatedChat });
    }

    if (parts[4] === 'toggle-pause' && method === 'POST') {
      const body = await parseBody();
      const updated = db.toggleBotPause(phone, body.paused);
      return sendJSON({ success: true, chat: updated });
    }
  }

  if (pathname === '/api/simulate' && method === 'POST') {
    const body = await parseBody();
    const { phone = '5492610000000', pushName = 'Usuario Simulación', message } = body;
    if (!message) return sendJSON({ error: 'El mensaje no puede estar vacío' }, 400);

    try {
      const reply = await processIncomingMessage(phone, pushName, message);
      const updatedChat = db.getChat(phone);
      return sendJSON({
        success: true,
        reply,
        chatHistory: updatedChat ? updatedChat.messages : []
      });
    } catch (error) {
      return sendJSON({ error: 'Error procesando mensaje en simulador', details: error.message }, 500);
    }
  }

  if (pathname === '/api/whatsapp/status' && method === 'GET') {
    return sendJSON(whatsappManager.getStatus());
  }

  // --- STATIC FILES SERVING ---
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }

    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🏛️  Justi - S&S Abogados Server activo en puerto ${PORT}`);
  console.log(`💻 Panel de Administración: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
