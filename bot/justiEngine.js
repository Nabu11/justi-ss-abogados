import { db } from '../config/database.js';
import { generateJustiResponse } from '../config/groq.js';
import { checkForAppointmentConfirmation } from './appointmentExtractor.js';

export async function processIncomingMessage(phone, pushName, userMessage) {
  // Check if bot auto reply is paused for this specific chat
  const chat = db.getChat(phone);
  if (chat && chat.pausedBot) {
    db.saveMessage(phone, pushName, 'client', userMessage);
    return null; // Silent for bot, admin handles manually
  }

  // Save incoming client message
  const isUrgentMsg = checkIfUrgent(userMessage);
  const currentChat = db.saveMessage(phone, pushName, 'client', userMessage, isUrgentMsg);

  // Get conversation history (last 10 messages)
  const history = (currentChat.messages || []).slice(-10);

  // Generate response from Justi (Groq LLM)
  const botResponse = await generateJustiResponse(history, userMessage);

  // Save bot response
  db.saveMessage(phone, pushName, 'bot', botResponse);

  // Extract appointment if confirmed in response
  checkForAppointmentConfirmation(phone, history, botResponse);

  return botResponse;
}

function checkIfUrgent(text) {
  const t = text.toLowerCase();
  return t.includes('urgente') || t.includes('deten') || t.includes('violencia') || t.includes('comisaria') || t.includes('cautelar') || t.includes('plazo');
}
