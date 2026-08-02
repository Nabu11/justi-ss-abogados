import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { processIncomingMessage } from './justiEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export const whatsappEmitter = new EventEmitter();

class WhatsAppManager {
  constructor() {
    this.status = 'disconnected'; // 'disconnected', 'qr_ready', 'connected'
    this.qrCode = null;
    this.sock = null;
  }

  async initialize() {
    try {
      console.log('🏛️ Cargando librería Baileys para WhatsApp...');
      const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log('📱 ¡NUEVO CÓDIGO QR REAL DE WHATSAPP RECIBIDO!');
          try {
            const dataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 8 });
            this.qrCode = dataUrl;
            this.status = 'qr_ready';
            whatsappEmitter.emit('qr', this.qrCode);
            whatsappEmitter.emit('status', 'qr_ready');
          } catch (qrErr) {
            console.error('Error generando QR DataURL:', qrErr);
          }
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = (statusCode !== DisconnectReason?.loggedOut);
          console.log('⚠️ Conexión cerrada. Razón:', statusCode, '¿Reconectar?:', shouldReconnect);
          this.status = 'disconnected';
          whatsappEmitter.emit('status', 'disconnected');
          if (shouldReconnect) {
            setTimeout(() => this.initialize(), 3000);
          }
        } else if (connection === 'open') {
          console.log('✅ ¡Conectado exitosamente a WhatsApp!');
          this.status = 'connected';
          this.qrCode = null;
          whatsappEmitter.emit('status', 'connected');
        }
      });

      // Handle Incoming WhatsApp Messages & Media Attachments
      this.sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        for (const msg of m.messages) {
          if (!msg.key.fromMe && msg.message) {
            const senderJid = msg.key.remoteJid;
            const phone = senderJid.replace('@s.whatsapp.net', '');
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
        }
      });

    } catch (err) {
      console.error('Error en WhatsAppManager initialize:', err);
      this.status = 'disconnected';
      whatsappEmitter.emit('status', 'disconnected');
    }
  }

  getStatus() {
    return {
      status: this.status,
      qrCode: this.qrCode
    };
  }
}

export const whatsappManager = new WhatsAppManager();
