import { db } from '../config/database.js';

export function checkForAppointmentConfirmation(phone, conversationHistory, latestBotResponse) {
  const historyText = conversationHistory.map(m => m.text).join(' ') + ' ' + latestBotResponse;
  const lowerText = historyText.toLowerCase();

  // Check if bot sent confirmation message
  if (lowerText.includes('confirmada') || lowerText.includes('agendad') || lowerText.includes('quedó confirmada')) {
    // Extract info if possible
    let clientName = 'Cliente WhatsApp';
    let area = 'Consulta General';
    let modality = lowerText.includes('videollamada') ? 'Videollamada' : 'Presencial';
    let isUrgent = lowerText.includes('urgente');

    // Simple regex extractors
    const nameMatch = historyText.match(/(?:nombre|llam[oa])\s+es\s+([A-ZÁÉÍÓÚña-záéíóú\s]+)/i);
    if (nameMatch && nameMatch[1]) {
      clientName = nameMatch[1].trim();
    } else {
      const chat = db.getChat(phone);
      if (chat && chat.pushName) clientName = chat.pushName;
    }

    if (lowerText.includes('laboral')) area = 'Laboral';
    else if (lowerText.includes('penal')) area = 'Penal';
    else if (lowerText.includes('civil')) area = 'Civil';
    else if (lowerText.includes('familia')) area = 'Familia';
    else if (lowerText.includes('municip') || lowerText.includes('estado')) area = 'Litigios contra Estado/Municipio';

    // Auto-create appointment
    const newAppointment = {
      clientName,
      area,
      description: 'Consulta agendada automáticamente por Justi vía WhatsApp',
      isUrgent,
      date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
      time: '11:00',
      modality,
      phone,
      status: 'confirmado'
    };

    db.saveAppointment(newAppointment);
    return newAppointment;
  }

  return null;
}
