import { generateJustiResponse } from '../config/groq.js';
import { db } from '../config/database.js';
import { whatsappManager } from './whatsapp.js';

// Personal phone number of Nahuel for admin commands and notifications
const ADMIN_PHONE = '2615358877';
const ADMIN_JID_PHONE = '5492615358877@s.whatsapp.net';

export async function processIncomingMessage(phone, pushName, userMessage) {
  console.log(`📩 Mensaje recibido de ${pushName} (${phone}): "${userMessage}"`);

  const isAdmin = phone.includes(ADMIN_PHONE) || phone.includes('2615358877');

  // Handle Admin WhatsApp Commands for phone 2615358877
  if (isAdmin && userMessage.startsWith('!')) {
    const commandResult = await handleAdminCommand(userMessage);
    db.saveMessage(phone, pushName, 'client', userMessage);
    db.saveMessage(phone, pushName, 'bot', commandResult);
    return commandResult;
  }

  // Fetch chat state
  const chat = db.getChat(phone);
  const isBotPaused = chat && chat.pausedBot;

  // ALERT 1: Human Intervention Needed (If bot is paused in this chat)
  if (isBotPaused) {
    db.saveMessage(phone, pushName, 'client', userMessage);
    
    if (!isAdmin) {
      whatsappManager.sendAdminAlert(
        `⚠️ *INTERVENCIÓN MANUAL REQUERIDA (BOT PAUSADO)*\n` +
        `• *Cliente:* ${pushName} (${phone})\n` +
        `• *Mensaje:* "${userMessage}"\n` +
        `• *Acción:* Justi no respondió. Podés contestar desde tu celular o el panel.`
      );
    }
    return null; // Silent for bot, admin handles manually
  }

  // Save incoming client message
  const isUrgentMsg = checkIfUrgent(userMessage);
  const currentChat = db.saveMessage(phone, pushName, 'client', userMessage, isUrgentMsg);

  // ALERT 2: Urgent / Criminal Emergency Case Detected (Sent instantly to Nahuel's WhatsApp)
  if (isUrgentMsg && !isAdmin) {
    whatsappManager.sendAdminAlert(
      `🚨 *ALERTA DE EMERGENCIA PENAL URGENTE*\n` +
      `• *Cliente:* ${pushName} (${phone})\n` +
      `• *Mensaje de la Emergencia:* "${userMessage}"\n` +
      `• *Acción:* Justi informó que un abogado penalista se comunicará telefónicamente de inmediato.\n` +
      `• *Panel Web:* http://159.112.148.104:3000`
    );
  }

  // Get conversation history (last 10 messages)
  const history = (currentChat.messages || []).slice(-10);

  // Generate response from Justi (Groq LLM)
  const botResponse = await generateJustiResponse(history, userMessage, isAdmin);

  // Save bot response
  db.saveMessage(phone, pushName, 'bot', botResponse);

  // Extract appointment & ALERT 3: New Appointment Confirmed (Only for non-urgent ordinary bookings)
  if (!isAdmin && !isUrgentMsg) {
    const newApt = checkForAppointmentConfirmation(phone, history, botResponse);
    if (newApt) {
      whatsappManager.sendAdminAlert(
        `📅 *NUEVO TURNO AGENDADO*\n` +
        `• *Cliente:* ${newApt.clientName} (${newApt.phone})\n` +
        `• *Área:* ${newApt.area}\n` +
        `• *Modalidad:* ${newApt.modality}\n` +
        `• *Fecha/Hora:* ${newApt.date} a las ${newApt.time} hs\n` +
        `• *Ver en Panel:* http://159.112.148.104:3000`
      );
    }
  }

  return botResponse;
}

function checkIfUrgent(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  const emergencyKeywords = [
    'urgente', 'emergencia', 'detenido', 'detenida', 'detuvieron', 'detener',
    'comisaria', 'comisaría', 'preso', 'presa', 'penal', 'allanamiento', 'allanaron',
    'aprehendido', 'aprehendida', 'violencia', 'fiscalia', 'fiscalía', 'arresto', 'arrestado',
    'flagrancia', 'indagatoria', 'patrullero', 'patrulla', 'orden de detencion', 'orden de detención',
    'abogado penalista', 'delito', 'imputado', 'imputada', 'excarcelacion', 'excarcelación', 'echaron', 'golpe'
  ];
  return emergencyKeywords.some(k => t.includes(k));
}

async function handleAdminCommand(cmdText) {
  const cleanCmd = cmdText.trim().toLowerCase();

  if (cleanCmd.startsWith('!limpiar') || cleanCmd.startsWith('!borrar')) {
    db.clearAllData();
    return '🧹 *Base de Datos Limpiada*: Se han eliminado todos los turnos y conversaciones de prueba correctamente.';
  }

  if (cleanCmd.startsWith('!turnos') || cleanCmd.startsWith('!resumen')) {
    const apts = db.getAppointments();
    if (apts.length === 0) return '📅 *Resumen de Agenda*: No hay turnos agendados en el sistema por el momento.';
    
    let reply = `📅 *RESUMEN DE TURNOS AGENDADOS (${apts.length})*:\n`;
    apts.forEach((a, i) => {
      reply += `\n${i + 1}. *${a.clientName}* (${a.area})\n   • Fecha: ${a.date} a las ${a.time} hs\n   • Modalidad: ${a.modality}\n   • Estado: ${a.status.toUpperCase()}\n`;
    });
    return reply;
  }

  if (cleanCmd.startsWith('!status') || cleanCmd.startsWith('!estado')) {
    const settings = db.getSettings();
    const aptsCount = db.getAppointments().length;
    const chatsCount = db.getChats().length;

    return `⚡ *ESTADO DEL SERVIDOR S&S ABOGADOS*:\n` +
           `• *WhatsApp:* Conectado ✅\n` +
           `• *Motor IA:* ${settings.model}\n` +
           `• *Groq API Key:* ${settings.groqApiKey ? 'Configurada ✅' : 'No configurada (Modo Demostración)'}\n` +
           `• *Turnos Registrados:* ${aptsCount}\n` +
           `• *Chats Activos:* ${chatsCount}\n` +
           `• *Panel Web:* http://159.112.148.104:3000`;
  }

  if (cleanCmd.startsWith('!ayuda') || cleanCmd.startsWith('!help')) {
    return `💡 *COMANDOS DE ADMINISTRADOR DE S&S ABOGADOS*:\n\n` +
           `• *!turnos*: Muestra la lista completa de turnos agendados.\n` +
           `• *!status*: Muestra el estado técnico del servidor e Inteligencia Artificial.\n` +
           `• *!limpiar*: Borra todos los turnos y conversaciones de prueba para empezar de cero.\n` +
           `• *!ayuda*: Muestra esta lista de comandos.`;
  }

  return '❓ Comando no reconocido. Escribí *!ayuda* para ver la lista de comandos disponibles.';
}

function checkForAppointmentConfirmation(phone, history, botResponse) {
  const respLower = botResponse.toLowerCase();
  const isConfirmation = respLower.includes('agendad') || respLower.includes('confirmad') || respLower.includes('registrad') || respLower.includes('quedó anotad');

  if (!isConfirmation) return null;

  const chat = db.getChat(phone);
  const clientName = (chat && chat.pushName && chat.pushName !== 'Cliente WhatsApp') ? chat.pushName : 'Cliente WhatsApp';

  let area = 'General';
  const fullText = history.map(h => h.text).join(' ').toLowerCase();
  if (fullText.includes('penal') || fullText.includes('comisaria') || fullText.includes('preso')) area = 'Penal';
  else if (fullText.includes('laboral') || fullText.includes('despido') || fullText.includes('trabajo')) area = 'Laboral';
  else if (fullText.includes('familia') || fullText.includes('divorcio') || fullText.includes('alimentos')) area = 'Familia';
  else if (fullText.includes('civil') || fullText.includes('accidente') || fullText.includes('daños')) area = 'Civil';

  const modality = (fullText.includes('virtual') || fullText.includes('videollamada')) ? 'Videollamada' : 'Presencial';

  // Fallback appointment registration
  const today = new Date().toISOString().split('T')[0];
  const newApt = {
    clientName,
    area,
    modality,
    date: today,
    time: '16:00',
    phone,
    description: 'Turno acordado vía chat automático por Justi',
    isUrgent: false,
    status: 'confirmado'
  };

  db.saveAppointment(newApt);
  return newApt;
}
