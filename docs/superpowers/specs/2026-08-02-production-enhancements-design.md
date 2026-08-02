# Especificación de Diseño: Mejoras de Producción para Justi (S&S Abogados)

## 1. Resumen
Implementación completa de las 6 mejoras de grado de producción antes del despliegue en Oracle Cloud:
1. Autenticación de usuarios para proteger el panel de administración.
2. Recordatorios automáticos por WhatsApp (24hs antes del turno).
3. Notificaciones sonoras (Web Audio API) y alertas de escritorio para casos urgentes.
4. Exportación de citas a Google Calendar y archivo universal `.ics`.
5. Exportación de turnos a Excel/CSV y vista de impresión PDF.
6. Copia de seguridad automática (Backup diario de base de datos).

---

## 2. Arquitectura de las Mejoras

### 🔒 A. Autenticación de Acceso al Panel Web
- **Mecanismo:** Token de sesión simple almacenado en `cookie` o `localStorage`.
- **Credenciales por defecto:** `admin` / `sysabogados2026` (modificables desde el panel de ajustes).
- **Rutas protegidas:** `/`, `/api/appointments`, `/api/chats`, `/api/settings`.
- **Rutas públicas:** `/login.html`, `/api/login`, `/api/whatsapp/events`.

### ⏰ B. Recordatorios Automáticos de Turnos (WhatsApp Cron)
- **Frecuencia:** Verificación cada 1 hora.
- **Lógica:** Selecciona citas confirmadas para el día siguiente (`date === fecha_mañana`), verifica si `reminderSent` es `false`, envía mensaje oficial por WhatsApp y marca `reminderSent = true`.

### 🔔 C. Alertas Sonoras y Notificaciones Push
- **Síntesis Sonora:** Generador de audio sin dependencias externas usando Web Audio API (`AudioContext` con tono armónico).
- **Notificaciones del Navegador:** `Notification.requestPermission()` notificando: *"🚨 NUEVO CASO URGENTE DETECTADO - [Cliente]"*.

### 📅 D. Integración con Calendarios
- **Google Calendar:** Enlace dinámico `https://calendar.google.com/calendar/render?action=TEMPLATE&text=...`
- **Descarga .ics:** Endpoint `/api/appointments/:id/ics` sirviendo archivo de formato iCalendar estándar.

### 📊 E. Exportador Excel/CSV y Modo Impresión PDF
- Exportación instantánea a CSV descargable (abrible en Excel).
- Reglas CSS `@media print` para imprimir una planilla limpia de turnos en PDF.

### 💾 F. Copia de Seguridad Automática
- Creación de copias diarias en `data/backups/backup-YYYY-MM-DD.json`.
