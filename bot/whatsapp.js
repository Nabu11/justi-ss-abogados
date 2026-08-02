import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { processIncomingMessage } from './justiEngine.js';
import { db } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export const whatsappEmitter = new EventEmitter();

// Deduplication set for processed message IDs
const processedMsgIds = new Set();

class WhatsAppManager {
  constructor() {
    this.status = 'disconnected'; // 'disconnected', 'qr_ready', 'connected'
    this.qrCode = null;
    this.sock = null;
    this.adminPhoneJid = '5492615358877@s.whatsapp.net';
  }

  async initialize() {
    try {
      const authPath = path.join(__dirname, '..', 'data', 'baileys_auth_info');
      const { state, saveCreds } = await useMultiFileAuthState(authPath);

      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        defaultQueryTimeoutMs: undefined
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log('📱 Código QR de WhatsApp generado. Escanéalo en el panel web.');
          try {
            this.qrCode = await QRCode.toDataURL(qr);
            this.status = 'qr_ready';
            whatsappEmitter.emit('qr', this.qrCode);
            whatsappEmitter.emit('status', 'qr_ready');
          } catch (qrErr) {
            console.error('Error generando QR DataURL:', qrErr);
          }
        }

        if (connection === 'close') {
          const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
          console.log(`❌ Conexión cerrada. Razón: ${lastDisconnect?.error}. Reconectando: ${shouldReconnect}`);
          this.status = 'disconnected';
          whatsappEmitter.emit('status', 'disconnected');
          if (shouldReconnect) {
            setTimeout(() => this.initialize(), 5000);
          }
        } else if (connection === 'open') {
          console.log('✅ ¡Conectado exitosamente a WhatsApp!');
          this.status = 'connected';
          this.qrCode = null;
          whatsappEmitter.emit('status', 'connected');
        }
      });

      // Handle Incoming & Outbound WhatsApp Messages
      this.sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
          if (!msg.key || !msg.message) continue;

          // 1. Deduplication Check by Message ID
          const msgId = msg.key.id;
          if (msgId && processedMsgIds.has(msgId)) {
            continue;
          }
          if (msgId) processedMsgIds.add(msgId);

          // Handle Outbound Messages sent manually by Nahuel from phone or Web
          if (msg.key.fromMe) {
            const remoteJid = msg.key.remoteJid;
            if (remoteJid && !remoteJid.includes('@g.us') && !remoteJid.includes(this.adminPhoneJid)) {
              const clientPhone = remoteJid.split('@')[0];
              const pushName = msg.pushName || clientPhone;
              const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
              
              // Filter out system automated alerts sent by Baileys
              if (text && !text.startsWith('🔔 *ALERTA JUSTI') && !text.startsWith('⏰ *ALERTA') && !text.startsWith('🚨 *ALERTA')) {
                db.saveMessage(clientPhone, pushName, 'admin', text);
                
                // AUTO-PAUSE Justi for this client chat when lawyer messages manually!
                db.toggleBotPause(clientPhone, true);
                console.log(`⏸ Bot pausado automáticamente en el chat con ${pushName} (${clientPhone}) por respuesta manual del abogado.`);
              }
            }
            continue;
          }

          // 2. Ignore Historical Messages (Received during initial WhatsApp sync > 60 seconds old)
          const msgTimestamp = (msg.messageTimestamp || 0) * 1000;
          if (msgTimestamp > 0 && (Date.now() - msgTimestamp > 60000)) {
            console.log(`⏳ Ignorando mensaje antiguo del historial (timestamp: ${new Date(msgTimestamp).toLocaleTimeString()})`);
            continue;
          }

          const senderJid = msg.key.remoteJid;
          const phone = senderJid.split('@')[0];
          const pushName = msg.pushName || 'Cliente WhatsApp';

          let conversationText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
          const isMedia = msg.message.imageMessage || msg.message.documentMessage || msg.message.videoMessage;

          // Handle Media Attachment Download
          if (isMedia) {
            try {
              const buffer = await downloadMediaMessage(msg, 'buffer', {});
              const ext = msg.message.imageMessage ? '.jpg' : msg.message.documentMessage ? '.pdf' : '.bin';
              const filename = `doc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}${ext}`;
              const filepath = path.join(UPLOADS_DIR, filename);
              fs.writeFileSync(filepath, buffer);
              const mediaUrl = `/uploads/${filename}`;
              console.log(`📁 Adjunto descargado de ${pushName}: ${mediaUrl}`);
              
              conversationText += ` [Archivo Adjunto: ${mediaUrl}]`;
            } catch (mediaErr) {
              console.error('Error descargando adjunto de WhatsApp:', mediaErr.message);
            }
          }

          if (conversationText) {
            console.log(`📩 Mensaje recibido de ${pushName} (${phone}): "${conversationText}"`);
            const botReply = await processIncomingMessage(phone, pushName, conversationText);

            if (botReply) {
              console.log(`🤖 Justi responde a ${pushName}: "${botReply}"`);
              await this.sock.sendMessage(senderJid, { text: botReply });
            }
          }
        }
      });

    } catch (err) {
      console.error('Error en WhatsAppManager initialize:', err);
      this.status = 'disconnected';
      whatsappEmitter.emit('status', 'disconnected');
    }
  }

  async sendAdminAlert(alertMessage) {
    if (this.sock && this.status === 'connected') {
      try {
        await this.sock.sendMessage(this.adminPhoneJid, { text: `🔔 *ALERTA JUSTI (S&S Abogados)*\n\n${alertMessage}` });
        console.log('📲 Alerta de administración enviada a Nahuel por WhatsApp');
      } catch (err) {
        console.error('Error enviando alerta por WhatsApp al administrador:', err.message);
      }
    } else {
      console.warn('No se pudo enviar alerta de administración: WhatsApp no está conectado.');
    }
  }
}

export const whatsappManager = new WhatsAppManager();
