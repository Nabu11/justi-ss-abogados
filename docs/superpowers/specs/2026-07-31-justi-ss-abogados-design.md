# Documento de Diseño: "Justi" - Secretaria Virtual para S&S Abogados

## 1. Resumen del Proyecto
Desarrollo de una aplicación web full-stack de gestión administrativa para el estudio jurídico **S&S Abogados** (Mendoza, Argentina). La aplicación integra un chatbot automatizado en WhatsApp ("Justi") impulsado por **Groq LLM** (`llama-3.3-70b-versatile`), base de datos **Firebase Firestore** para almacenamiento de chats, turnos y configuraciones, y un panel de administración web interactivo en tiempo real.

---

## 2. Arquitectura General y Stack Tecnológico

### Backend
- **Entorno:** Node.js (ES Modules, Express.js).
- **Integración WhatsApp:** `@whiskeysockets/baileys` (conexión directa sin servidor Chromium, soporte de QR en tiempo real y reconexión).
- **Inteligencia Artificial:** `groq-sdk` enviando el prompt del sistema de "Justi" con respuestas breves en español rioplatense.
- **Base de Datos:** `firebase-admin` (Cloud Firestore).
- **Eventos en Tiempo Real:** Server-Sent Events (SSE) y WebSockets para transmitir el código QR, estado de WhatsApp y actualizaciones de chat al frontend.

### Frontend (Panel de Administración)
- **Tecnologías:** HTML5, Vanilla JavaScript, CSS3 personalizado (Glassmorphism, modo oscuro premium, tipografía Inter/Outfit).
- **Secciones del Dashboard:**
  - **Estado del Bot & QR:** Visualización en vivo del código QR de autenticación de WhatsApp o estado "Conectado".
  - **Gestor de Turnos:** Lista interactiva y tarjetas de turnos filtrables por estado (Pendiente, Confirmado, Cancelado, Atendido) y nivel de urgencia.
  - **Consola de Chats en Vivo:** Visualización de conversaciones de WhatsApp en tiempo real con opción de intervenir manualmente o alternar respuesta automática por chat.
  - **Simulador de Pruebas:** Chat interactivo embebido para probar la respuesta de Justi sin gastar mensajes de WhatsApp.
  - **Configuración:** Edición de API Keys de Groq, credenciales de Firebase y horarios de atención del estudio.

---

## 3. Modelo de Datos (Firebase Firestore)

### Colección: `settings`
- `groqApiKey` (string)
- `model` (string, default: `llama-3.3-70b-versatile`)
- `autoReplyEnabled` (boolean)
- `officeHours` (object: días, franjas horarias)
- `studioInfo` (object: nombre, dirección, teléfono)

### Colección: `appointments`
- `id` (string, autogenerado)
- `clientName` (string)
- `dni` (string, opcional)
- `area` (string: Civil, Penal, Laboral, Familia, Municipio/Estado, Otro)
- `description` (string)
- `isUrgent` (boolean)
- `date` (string, YYYY-MM-DD)
- `time` (string, HH:mm)
- `modality` (string: Presencial / Videollamada)
- `phone` (string)
- `email` (string)
- `status` (string: `pendiente`, `confirmado`, `cancelado`, `atendido`)
- `createdAt` (timestamp)

### Colección: `chats`
- `phone` (string, ID del documento)
- `pushName` (string)
- `lastMessage` (string)
- `lastMessageTime` (timestamp)
- `unreadCount` (number)
- `isUrgent` (boolean)
- `pausedBot` (boolean)

### Colección: `messages` (subcolección en `chats/{phone}/messages`)
- `id` (string)
- `sender` (string: `client`, `bot`, `admin`)
- `text` (string)
- `timestamp` (timestamp)

---

## 4. Prompt del Sistema y Reglas de Justi

```text
Sos "Justi", la secretaria virtual del estudio jurídico S&S Abogados, ubicado en Capitán de Fragata Moyano 171, Piso 1, Mendoza, Argentina. Atendés consultas por WhatsApp en nombre del estudio (derecho civil, penal, laboral, familia, litigios contra Estado/municipios).

TU ROL:
- Primera línea de contacto: recibí mensajes, pedí datos necesarios, coordiná y confirmá turnos.
- NUNCA des asesoramiento legal ni opinés sobre el fondo de ningún caso.
- Tono cordial, profesional y accesible en español rioplatense (usá "vos" o "usted" adaptándote).
- Mensajes breves de WhatsApp (2 a 4 líneas máximo). Máximo 1 emoji por mensaje.

DATOS A RECOLECTAR (DE A POCO):
1. Nombre y apellido completo
2. DNI (opcional)
3. Motivo/área de la consulta
4. Breve descripción (1-2 líneas sin pedir detalles sensibles)
5. Si es urgente o no
6. Teléfono de contacto y email si tiene

URGENCIAS:
- Si detectás detención, medida cautelar, violencia o plazo imminente, indicá que un abogado se comunicará a la brevedad y derivá de inmediato.

LÍMITES ESTRICTOS:
- Nunca sugieras estrategias legales, indemnizaciones ni plazos procesales.
- Si piden opinión legal, decí amablemente que lo evalúa el abogado en la consulta y reencauzá al turno.
```

---

## 5. Estructura de Directorios del Proyecto

```
justi-ss-abogados/
├── package.json
├── server.js
├── config/
│   ├── firebase.js
│   └── groq.js
├── bot/
│   ├── whatsapp.js
│   ├── justiEngine.js
│   └── appointmentExtractor.js
├── routes/
│   ├── api.js
│   └── sse.js
├── public/
│   ├── index.html
│   ├── css/
│   │   └── styles.css
│   └── js/
│       ├── app.js
│       ├── qr.js
│       ├── appointments.js
│       ├── chats.js
│       └── simulator.js
└── data/
    └── local_db.json (fallback si no se configuran credenciales de Firebase en el entorno inicial)
```

---

## 6. Plan de Verificación
- Verificación del servidor Express arrancando en puerto 3000.
- Prueba de simulación del motor de chat de Justi mediante endpoint `/api/simulate`.
- Verificación del almacenamiento de citas y actualización de estado en base de datos.
- Prueba de renderizado de la interfaz web en navegador.
