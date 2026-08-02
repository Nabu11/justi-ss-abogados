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
      return JSON.parse(data);
    } catch (e) {
      return initialData;
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
    return Object.values(db.chats || {});
  }

  getChat(phone) {
    const db = this._read();
    return db.chats[phone] || null;
  }

  saveMessage(phone, pushName, sender, text, isUrgent = false) {
    const db = this._read();
    if (!db.chats[phone]) {
      db.chats[phone] = {
        phone,
        pushName: pushName || phone,
        lastMessage: text,
        lastMessageTime: new Date().toISOString(),
        unreadCount: sender === 'client' ? 1 : 0,
        isUrgent: isUrgent,
        pausedBot: false,
        messages: []
      };
    }

    const chat = db.chats[phone];
    chat.lastMessage = text;
    chat.lastMessageTime = new Date().toISOString();
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
    if (db.chats[phone]) {
      db.chats[phone].pausedBot = paused;
      this._write(db);
    }
    return db.chats[phone];
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
