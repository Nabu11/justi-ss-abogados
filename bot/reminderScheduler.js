import { db } from '../config/database.js';
import { whatsappManager } from './whatsapp.js';

let lastMorningReportDate = '';

export function startReminderScheduler() {
  console.log('⏰ Servicio de recordatorios automáticos de WhatsApp iniciado.');

  // Run checks every 15 minutes
  setInterval(() => {
    checkAndSendReminders();
    checkAndSendMorningReport();
    checkPausedChatInactivity();
  }, 15 * 60 * 1000);

  // Initial check after server start
  setTimeout(() => {
    checkAndSendReminders();
    checkAndSendMorningReport();
    checkPausedChatInactivity();
  }, 12000);
}

export async function checkAndSendReminders() {
  const settings = db.getSettings();
  if (settings.autoRemindersEnabled === false) return;

  if (whatsappManager.status !== 'connected' || !whatsappManager.sock) {
    return;
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const appointments = db.getAppointments();
  const pendingReminders = appointments.filter(a => 
    a.date === tomorrowStr && 
    (a.status === 'confirmado' || a.status === 'pendiente') && 
    !a.reminderSent &&
    a.phone
  );

  for (const apt of pendingReminders) {
    const formattedPhone = apt.phone.replace(/[^0-9]/g, '');
    const jid = `${formattedPhone}@s.whatsapp.net`;

    const locationInfo = (apt.modality === 'Presencial' && new Date(apt.date).getDay() === 5)
      ? '📍 Dirección: Capitán de Fragata Moyano 171, Piso 1, Mendoza.'
      : '📍 Lugar/Enlace: A confirmar según disponibilidad del abogado.';

    const reminderMsg = `¡Hola ${apt.clientName}! 👋 Te recordamos tu consulta agendada para mañana (${apt.date}) a las ${apt.time} hs en S&S Abogados.\n\nModalidad: ${apt.modality}.\n${locationInfo}\n\nPor favor recordá asistir con tu DNI. Si necesitas reprogramar, avisanos por este medio.`;

    try {
      console.log(`⏰ Enviando recordatorio automático por WhatsApp a ${apt.clientName} (${apt.phone})...`);
      await whatsappManager.sock.sendMessage(jid, { text: reminderMsg });
      db.markReminderSent(apt.id);
      db.saveMessage(formattedPhone, apt.clientName, 'bot', reminderMsg);
    } catch (err) {
      console.error(`Error enviando recordatorio a ${apt.phone}:`, err.message);
    }
  }
}

export async function checkAndSendMorningReport() {
  if (whatsappManager.status !== 'connected' || !whatsappManager.sock) return;

  // Mendoza Time (UTC-3)
  const now = new Date();
  const utcHours = now.getUTCHours() - 3;
  const currentHour = utcHours < 0 ? utcHours + 24 : utcHours;
  const todayStr = now.toISOString().split('T')[0];

  // Send report between 8:00 AM and 9:00 AM once per day
  if (currentHour === 8 && lastMorningReportDate !== todayStr) {
    lastMorningReportDate = todayStr;

    const apts = db.getAppointments();
    const todayApts = apts.filter(a => a.date === todayStr && a.status !== 'cancelado');

    let reportMsg = `☀️ *BUENOS DÍAS NAHUEL - RESUMEN DIARIO S&S ABOGADOS*\n📅 Fecha: ${todayStr}\n\n`;

    if (todayApts.length === 0) {
      reportMsg += `☀️ ¡Agenda despejada para hoy! No hay consultas agendadas por el momento. Justi sigue atendiendo en WhatsApp.`;
    } else {
      reportMsg += `📋 *Consultas Agendadas para Hoy (${todayApts.length}):*\n\n`;
      todayApts.forEach((a, i) => {
        reportMsg += `${i + 1}. *${a.time} hs* - ${a.clientName} (${a.area})\n   📱 Tel: ${a.phone} | Modalidad: ${a.modality}\n\n`;
      });
      reportMsg += `👉 Ver más detalles en el panel: http://159.112.148.104:3000`;
    }

    try {
      await whatsappManager.sendAdminAlert(reportMsg);
      console.log('☀️ Reporte matutino diario enviado exitosamente a Nahuel.');
    } catch (err) {
      console.error('Error enviando reporte matutino:', err);
    }
  }
}

export async function checkPausedChatInactivity() {
  if (whatsappManager.status !== 'connected' || !whatsappManager.sock) return;

  const now = new Date();
  const utcHours = now.getUTCHours() - 3;
  const currentHour = utcHours < 0 ? utcHours + 24 : utcHours;

  // Only send inactivity alerts during daytime / office hours (8:00 to 20:00)
  if (currentHour < 8 || currentHour >= 20) return;

  const chats = db.getChats();
  const pausedChats = chats.filter(c => c.pausedBot && !c.inactivityAlertSent && c.lastMessageTime);

  for (const chat of pausedChats) {
    const lastTime = new Date(chat.lastMessageTime).getTime();
    const elapsedMinutes = (now.getTime() - lastTime) / (1000 * 60);

    // If chat has been inactive for 2 hours (120 minutes)
    if (elapsedMinutes >= 120) {
      const hoursStr = (elapsedMinutes / 60).toFixed(1);
      const timeFormatted = new Date(chat.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const alertMsg = 
        `⏰ *ALERTA DE INACTIVIDAD EN CHAT PAUSADO*\n` +
        `• *Cliente:* ${chat.pushName} (${chat.phone})\n` +
        `• *Último mensaje registrado:* "${chat.lastMessage}"\n` +
        `• *Tiempo sin interacción:* ${hoursStr} horas (último mensaje: ${timeFormatted} hs)\n` +
        `• *Estado:* Bot pausado por respuesta manual.\n` +
        `• *Acción:* Podés responderle desde tu celular o reactivar a Justi enviando: '!reanudar ${chat.pushName}'`;

      try {
        await whatsappManager.sendAdminAlert(alertMsg);
        db.markInactivityAlertSent(chat.phone, true);
        console.log(`⏰ Alerta de inactividad enviada a Nahuel para el chat pausado de ${chat.pushName}`);
      } catch (err) {
        console.error('Error enviando alerta de inactividad:', err);
      }
    }
  }
}
