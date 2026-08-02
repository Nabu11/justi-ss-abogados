import { db } from '../config/database.js';
import { whatsappManager } from './whatsapp.js';

export function startReminderScheduler() {
  console.log('⏰ Servicio de recordatorios automáticos de WhatsApp iniciado.');

  // Run check every 30 minutes
  setInterval(checkAndSendReminders, 30 * 60 * 1000);

  // Initial check after server start (after 10s delay to allow WhatsApp initialization)
  setTimeout(checkAndSendReminders, 10000);
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
    a.status === 'confirmado' && 
    !a.reminderSent &&
    a.phone
  );

  for (const apt of pendingReminders) {
    const formattedPhone = apt.phone.replace(/[^0-9]/g, '');
    const jid = `${formattedPhone}@s.whatsapp.net`;

    const reminderMsg = `¡Hola ${apt.clientName}! 👋 Te recordamos tu consulta mañana (${apt.date}) a las ${apt.time}hs en S&S Abogados.\n\n📍 Dirección: Capitán de Fragata Moyano 171, Piso 1, Mendoza.\nModalidad: ${apt.modality}.\n\nSi necesitas modificar tu turno, avisanos por este medio.`;

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
