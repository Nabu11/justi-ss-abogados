import { generateJustiResponse } from '../config/groq.js';
import { db } from '../config/database.js';
import { whatsappManager } from './whatsapp.js';
import { checkAndSendMorningReport } from './reminderScheduler.js';

// Personal phone number of Nahuel for admin commands and notifications
const ADMIN_PHONE = '2615358877';
const ADMIN_LID = '192182690549936';

export async function processIncomingMessage(phone, pushName, userMessage) {
  console.log(`📩 Mensaje recibido de ${pushName} (${phone}): "${userMessage}"`);

  // Airtight admin identification (phone, multi-device LID, or pushName)
  const isAdmin = phone.includes(ADMIN_PHONE) || 
                  phone.includes(ADMIN_LID) || 
                  (pushName && pushName.toLowerCase().includes('nahuel'));

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

  // Command: !ayuda / !help
  if (cleanCmd.startsWith('!ayuda') || cleanCmd.startsWith('!help') || cleanCmd === '!') {
    return `👨‍⚖️ *COMANDOS DE ADMINISTRADOR (S&S ABOGADOS)*\n\n` +
           `• *!agendar <nombre, tel, área, fecha, hora, modalidad>*: Agenda un turno manualmente.\n` +
           `• *!turnos*: Muestra la lista de turnos y citas agendadas.\n` +
           `• *!urgentes*: Muestra la lista de casos urgentes y emergencias penales.\n` +
           `• *!reporte*: Te envía el reporte matutino con la agenda del día a tu WhatsApp.\n` +
           `• *!status*: Revisa el estado del servidor, Inteligencia Artificial y WhatsApp.\n` +
           `• *!pausa <telefono_o_nombre>*: Pausa a Justi en un chat específico para responder vos.\n` +
           `• *!reanudar <telefono_o_nombre>*: Reactiva a Justi en esa conversación.\n` +
           `• *!limpiar*: Borra turnos y chats de prueba para empezar de cero.\n` +
           `• *!ayuda*: Muestra esta lista de comandos.`;
  }

  // Command: !agendar <Nombre>, <Telefono>, <Area>, <Fecha YYYY-MM-DD>, <Hora HH:MM>, <Presencial/Videollamada>
  if (cleanCmd.startsWith('!agendar') || cleanCmd.startsWith('!nuevo')) {
    const rawArgs = cmdText.replace(/^[!](agendar|nuevo)\s*/i, '').trim();
    if (!rawArgs || !rawArgs.includes(',')) {
      return `📅 *COMO AGENDAR UN TURNO MANUALMENTE*:\n\n` +
             `Enviá un mensaje con los datos separados por comas:\n` +
             `*!agendar Nombre, Teléfono, Área, Fecha(AAAA-MM-DD), Hora(HH:MM), Presencial/Videollamada*\n\n` +
             `*Ejemplo:* \n` +
             `!agendar María Fernández, 2615551234, Civil, 2026-08-10, 16:00, Presencial`;
    }

    const parts = rawArgs.split(',').map(p => p.trim());
    const clientName = parts[0] || 'Cliente Externo';
    const phone = parts[1] || 'S/D';
    const area = parts[2] || 'General';
    const date = parts[3] || new Date().toISOString().split('T')[0];
    const time = parts[4] || '16:00';
    const modality = (parts[5] && parts[5].toLowerCase().includes('vid')) ? 'Videollamada' : 'Presencial';

    const newApt = {
      clientName,
      dni: '',
      area,
      modality,
      date,
      time,
      phone,
      description: 'Turno registrado manualmente fuera del bot por el abogado',
      isUrgent: false,
      status: 'confirmado'
    };

    db.saveAppointment(newApt);
    return `✅ *TURNO EXTERNO REGISTRADO EXITOSAMENTE*:\n` +
           `• *Cliente:* ${newApt.clientName}\n` +
           `• *Teléfono:* ${newApt.phone}\n` +
           `• *Área:* ${newApt.area}\n` +
           `• *Fecha/Hora:* ${newApt.date} a las ${newApt.time} hs (${newApt.modality})\n` +
           `• *Estado:* Confirmado ✅`;
  }

  // Command: !limpiar / !borrar
  if (cleanCmd.startsWith('!limpiar') || cleanCmd.startsWith('!borrar')) {
    db.clearAllData();
    return '🧹 *Base de Datos Limpiada*: Se han eliminado todos los turnos y conversaciones de prueba correctamente.';
  }

  // Command: !turnos / !resumen
  if (cleanCmd.startsWith('!turnos') || cleanCmd.startsWith('!resumen')) {
    const apts = db.getAppointments();
    if (apts.length === 0) return '📅 *Resumen de Agenda*: No hay turnos agendados en el sistema por el momento.';
    
    let reply = `📅 *RESUMEN DE TURNOS AGENDADOS (${apts.length})*:\n`;
    apts.forEach((a, i) => {
      reply += `\n${i + 1}. *${a.clientName}* (${a.area})\n   • Fecha: ${a.date} a las ${a.time} hs\n   • Modalidad: ${a.modality}\n   • Estado: ${a.status.toUpperCase()}\n`;
    });
    return reply;
  }

  // Command: !urgentes
  if (cleanCmd.startsWith('!urgentes')) {
    const apts = db.getAppointments().filter(a => a.isUrgent);
    const chats = db.getChats().filter(c => c.isUrgent);

    if (apts.length === 0 && chats.length === 0) {
      return '🚨 *Casos Urgentes*: No hay emergencias ni casos urgentes pendientes por el momento. ✅';
    }

    let reply = `🚨 *CASOS URGENTES Y EMERGENCIAS (${chats.length})*:\n`;
    chats.forEach((c, i) => {
      reply += `\n${i + 1}. *${c.pushName}* (${c.phone})\n   • Último mensaje: "${c.lastMessage}"\n   • Hora: ${new Date(c.lastMessageTime).toLocaleTimeString()}\n`;
    });
    return reply;
  }

  // Command: !reporte
  if (cleanCmd.startsWith('!reporte')) {
    await checkAndSendMorningReport();
    return '☀️ *Reporte Generado*: Se ha enviado el resumen diario a tu celular.';
  }

  // Command: !status / !estado
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

  // Command: !pausa <target>
  if (cleanCmd.startsWith('!pausa')) {
    const target = cleanCmd.replace('!pausa', '').trim();
    if (!target) return '⚠️ Modo de uso: *!pausa <telefono_o_nombre>* (ej: !pausa 2615551234)';
    const updated = db.toggleBotPause(target, true);
    if (updated) return `⏸ *Bot Pausado*: Justi no responderá en el chat de *${updated.pushName}*. Podés responder vos manualmente.`;
    return `⚠️ No se encontró ninguna conversación activa con: *${target}*.`;
  }

  // Command: !reanudar <target>
  if (cleanCmd.startsWith('!reanudar')) {
    const target = cleanCmd.replace('!reanudar', '').trim();
    if (!target) return '⚠️ Modo de uso: *!reanudar <telefono_o_nombre>* (ej: !reanudar 2615551234)';
    const updated = db.toggleBotPause(target, false);
    if (updated) return `▶ *Bot Reanudado*: Justi vuelve a responder automáticamente a *${updated.pushName}*.`;
    return `⚠️ No se encontró ninguna conversación activa con: *${target}*.`;
  }

  return '❓ Comando no reconocido. Escribí *!ayuda* para ver la lista de comandos de administración.';
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
