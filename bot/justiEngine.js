import { db } from '../config/database.js';
import { generateJustiResponse } from '../config/groq.js';
import { checkForAppointmentConfirmation } from './appointmentExtractor.js';
import { whatsappManager } from './whatsapp.js';

function isAdminPhone(phone) {
  const clean = phone.replace(/\D/g, '');
  return clean.includes('2615358877');
}

export async function processIncomingMessage(phone, pushName, userMessage) {
  const isAdmin = isAdminPhone(phone);
  const trimmedMsg = userMessage.trim();

  // Handle WhatsApp Admin Commands for 2615358877
  if (isAdmin && trimmedMsg.startsWith('!')) {
    const cmd = trimmedMsg.toLowerCase();

    if (cmd === '!limpiar' || cmd === '!borrar') {
      db.clearAllData();
      return '🧹 ¡Hola Nahuel! Se han eliminado todos los turnos y chats de prueba del sistema de forma segura. El panel web está 100% limpio.';
    }

    if (cmd === '!turnos' || cmd === '!resumen') {
      const apts = db.getAppointments();
      if (apts.length === 0) {
        return '📋 Agenda libre. No hay turnos agendados en este momento.';
      }
      let summary = `📋 Resumen de Turnos Agendados (${apts.length}):\n`;
      apts.slice(0, 5).forEach((a, i) => {
        summary += `${i + 1}. ${a.clientName} - ${a.area} (${a.date} ${a.time}hs) [${a.modality}]\n`;
      });
      return summary;
    }

    if (cmd === '!status' || cmd === '!estado') {
      const settings = db.getSettings();
      const hasKey = !!(settings.groqApiKey || process.env.GROQ_API_KEY);
      return `🟢 Justi Servidor Oracle Cloud Activo (159.112.148.104)\n• IA Groq Llama 3.3 70B: ${hasKey ? 'HABILITADA ✅' : 'OFFLINE (Falta API Key)'}\n• WhatsApp: Conectado ✅\n• Titular: Nahuel S&S Abogados`;
    }

    if (cmd === '!ayuda' || cmd === '!help') {
      return `👑 Comandos de Administrador (S&S Abogados):\n• !limpiar ➔ Borra chats y turnos de prueba\n• !turnos ➔ Muestra la lista de citas agendadas\n• !status ➔ Verifica el estado del servidor en la nube\n• !ayuda ➔ Muestra esta lista de comandos`;
    }
  }

  // ALERT 1: Bot is paused for this chat (Human intervention needed)
  const chat = db.getChat(phone);
  if (chat && chat.pausedBot) {
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

  // ALERT 2: Urgent / Legal Emergency Case Detected
  if (isUrgentMsg && !isAdmin) {
    whatsappManager.sendAdminAlert(
      `🚨 *CASO URGENTE / EMERGENCIA DETECTADO*\n` +
      `• *Cliente:* ${pushName} (${phone})\n` +
      `• *Mensaje:* "${userMessage}"\n` +
      `• *Panel Web:* http://159.112.148.104:3000`
    );
  }

  // Get conversation history (last 10 messages)
  const history = (currentChat.messages || []).slice(-10);

  // Generate response from Justi (Groq LLM)
  const botResponse = await generateJustiResponse(history, userMessage, isAdmin);

  // Save bot response
  db.saveMessage(phone, pushName, 'bot', botResponse);

  // Extract appointment & ALERT 3: New Appointment Confirmed
  if (!isAdmin) {
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
  const t = text.toLowerCase();
  return t.includes('urgente') || t.includes('deten') || t.includes('violencia') || t.includes('comisaria') || t.includes('cautelar') || t.includes('plazo');
}
