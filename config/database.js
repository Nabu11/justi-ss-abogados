import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const LOCAL_DB_FILE = path.join(DATA_DIR, 'local_db.json');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

const initialData = {
  settings: {
    adminUser: process.env.ADMIN_USER || 'admin',
    adminPass: process.env.ADMIN_PASS || 'sysabogados2026',
    groqApiKey: process.env.GROQ_API_KEY || '',
    model: 'llama-3.3-70b-versatile',
    autoReplyEnabled: true,
    autoRemindersEnabled: true,
    studioInfo: {
      name: 'S&S Abogados',
      address: 'Capitán de Fragata Moyano 171, Piso 1, Mendoza, Argentina',
      phone: '2617243850',
      areas: ['Civil', 'Penal', 'Laboral', 'Familia', 'Litigios contra el Estado y Municipios']
    }
  },
  appointments: [],
  chats: {}
};

class Database {
  constructor() {
    this.localFile = LOCAL_DB_FILE;
    this._ensureCleanFile();
    this._runAutoBackup();
  }

  _ensureCleanFile() {
    if (!fs.existsSync(this.localFile)) {
      this._write(initialData);
    }
  }

  _read() {
    try {
      const data = fs.readFileSync(this.localFile, 'utf-8');
      const parsed = JSON.parse(data);
      return {
        settings: parsed.settings || initialData.settings,
        appointments: Array.isArray(parsed.appointments) ? parsed.appointments : [],
        chats: (parsed.chats && typeof parsed.chats === 'object') ? parsed.chats : {}
      };
    } catch (e) {
      return { ...initialData };
    }
  }

  _write(data) {
    fs.writeFileSync(this.localFile, JSON.stringify(data, null, 2), 'utf-8');
  }

  _runAutoBackup() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const backupFile = path.join(BACKUPS_DIR, `backup-${today}.json`);
      if (!fs.existsSync(backupFile)) {
        const data = this._read();
        fs.writeFileSync(backupFile, JSON.stringify(data, null, 2), 'utf-8');
        console.log(`💾 Copia de seguridad creada: backup-${today}.json`);
      }
    } catch (err) {
      console.error('Error en respaldo automático:', err);
    }
  }

  getSettings() {
    const db = this._read();
    return db.settings || initialData.settings;
  }

  saveSettings(newSettings) {
    const db = this._read();
    const currentSettings = db.settings || initialData.settings;
    
    // Only update groqApiKey if a new non-empty value is provided
    const groqApiKey = (newSettings.groqApiKey && newSettings.groqApiKey.trim() !== '')
      ? newSettings.groqApiKey.trim()
      : currentSettings.groqApiKey;

    db.settings = { 
      ...currentSettings, 
      ...newSettings,
      groqApiKey
    };

    this._write(db);
    return db.settings;
  }

  getAppointments() {
    const db = this._read();
    return db.appointments || [];
  }

  saveAppointment(appointment) {
    const db = this._read();
    if (!appointment.id) {
      appointment.id = 'apt-' + Date.now();
    }
    appointment.createdAt = appointment.createdAt || new Date().toISOString();
    appointment.status = appointment.status || 'pendiente';
    appointment.reminderSent = appointment.reminderSent || false;
    
    const existingIndex = db.appointments.findIndex(a => a.id === appointment.id);
    if (existingIndex >= 0) {
      db.appointments[existingIndex] = { ...db.appointments[existingIndex], ...appointment };
    } else {
      db.appointments.unshift(appointment);
    }
    this._write(db);
    return appointment;
  }

  updateAppointmentStatus(id, status) {
    const db = this._read();
    const apt = db.appointments.find(a => a.id === id);
    if (apt) {
      apt.status = status;
      this._write(db);
    }
    return apt;
  }

  markReminderSent(id) {
    const db = this._read();
    const apt = db.appointments.find(a => a.id === id);
    if (apt) {
      apt.reminderSent = true;
      this._write(db);
    }
    return apt;
  }

  getChats() {
    const db = this._read();
    const chatsMap = db.chats || {};
    const mergedChats = {};

    // Group chats by pushName or phone to consolidate LID duplicates
    Object.values(chatsMap).forEach(chat => {
      if (!chat) return;
      const key = (chat.pushName && chat.pushName !== 'Cliente WhatsApp') 
        ? chat.pushName.toLowerCase().trim() 
        : chat.phone;

      if (!key) return;

      if (!mergedChats[key]) {
        mergedChats[key] = { ...chat, messages: [...(chat.messages || [])] };
      } else {
        // Merge messages and update last message info
        const target = mergedChats[key];
        target.messages = [...target.messages, ...(chat.messages || [])];
        // Sort by timestamp
        target.messages.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
        
        const lastMsgObj = target.messages[target.messages.length - 1];
        if (lastMsgObj) {
          target.lastMessage = lastMsgObj.text;
          target.lastMessageTime = lastMsgObj.timestamp;
        }
        if (chat.isUrgent) target.isUrgent = true;
        if (chat.pausedBot) target.pausedBot = true;
      }
    });

    return Object.values(mergedChats);
  }

  getChat(phone) {
    const chats = this.getChats();
    return chats.find(c => c.phone === phone || (c.pushName && phone && c.pushName.toLowerCase() === phone.toLowerCase())) || null;
  }

  saveMessage(phone, pushName, sender, text, isUrgent = false) {
    const db = this._read();
    if (!db.chats) db.chats = {};
    
    // Unify chat by pushName or phone to merge LID and phone JIDs
    let chatKey = phone;
    if (!db.chats[chatKey]) {
      const matchKey = Object.keys(db.chats).find(k => 
        db.chats[k] && db.chats[k].pushName && pushName && 
        db.chats[k].pushName.toLowerCase().trim() === pushName.toLowerCase().trim() && 
        pushName.toLowerCase() !== 'cliente whatsapp'
      );
      if (matchKey) {
        chatKey = matchKey;
      }
    }

    if (!db.chats[chatKey]) {
      db.chats[chatKey] = {
        phone: chatKey,
        pushName: pushName || chatKey,
        lastMessage: text,
        lastMessageTime: new Date().toISOString(),
        unreadCount: sender === 'client' ? 1 : 0,
        isUrgent: isUrgent,
        pausedBot: false,
        inactivityAlertSent: false,
        messages: []
      };
    }

    const chat = db.chats[chatKey];
    if (pushName && pushName !== 'Cliente WhatsApp') {
      chat.pushName = pushName;
    }
    chat.lastMessage = text;
    chat.lastMessageTime = new Date().toISOString();
    chat.inactivityAlertSent = false; // Reset alert flag on new message
    if (isUrgent) chat.isUrgent = true;
    if (sender === 'client') chat.unreadCount = (chat.unreadCount || 0) + 1;

    chat.messages.push({
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 5),
      sender,
      text,
      timestamp: new Date().toISOString()
    });

    this._write(db);
    return chat;
  }

  toggleBotPause(phone, paused) {
    const db = this._read();
    if (!db.chats) db.chats = {};
    const chatKey = Object.keys(db.chats).find(k => k === phone || (db.chats[k] && db.chats[k].pushName && db.chats[k].pushName.toLowerCase() === phone.toLowerCase()));
    if (chatKey && db.chats[chatKey]) {
      db.chats[chatKey].pausedBot = paused;
      if (!paused) db.chats[chatKey].inactivityAlertSent = false;
      this._write(db);
      return db.chats[chatKey];
    }
    return null;
  }

  markInactivityAlertSent(phone, sent = true) {
    const db = this._read();
    if (!db.chats) db.chats = {};
    const chatKey = Object.keys(db.chats).find(k => k === phone || (db.chats[k] && db.chats[k].pushName && db.chats[k].pushName.toLowerCase() === phone.toLowerCase()));
    if (chatKey && db.chats[chatKey]) {
      db.chats[chatKey].inactivityAlertSent = sent;
      this._write(db);
      return db.chats[chatKey];
    }
    return null;
  }

  clearAllData() {
    const db = this._read();
    db.appointments = [];
    db.chats = {};
    this._write(db);
    return db;
  }
}

export const db = new Database();
