# Especificación de Diseño: Funcionalidades Avanzadas para Justi

## 1. Resumen
Implementación de 5 características avanzadas para el bot de S&S Abogados:
1. Respuesta automática con enlaces GPS de Google Maps y Waze.
2. Descarga y visualización de archivos adjuntos (PDFs, imágenes de DNI, documentos) recibidos por WhatsApp en `public/uploads/`.
3. Tablero de analíticas y estadísticas del estudio (Distribución por áreas, urgencias, modalidades).
4. Detección de horario de atención (Lunes a Viernes de 8:00 a 20:00) con mensajes adaptados fuera de horario.
5. Botones de plantillas de respuestas rápidas en el chat de administración.

---

## 2. Detalles Técnicos

### 📍 1. Respuestas de Ubicación GPS
- Detección en el prompt de Justi y respuestas automáticas con enlace oficial a Google Maps (`https://maps.google.com/?q=-32.8988,-68.8475`).

### 📑 2. Gestor de Adjuntos de WhatsApp
- Procesamiento en `bot/whatsapp.js` con `downloadMediaMessage` de Baileys.
- Almacenamiento seguro en `public/uploads/` y enlace directo desde la interfaz de chat.

### 📊 3. Panel de Analíticas
- Endpoint `/api/analytics` calculando:
  - Citas por área jurídica.
  - Citas por modalidad.
  - Porcentaje de urgencias.

### 🌙 4. Detección de Horario de Atención
- Verificación de hora actual (hora Mendoza -3 UTC, Lunes a Viernes 8:00 a 20:00).
- Inserción de nota cordial fuera de horario sin interrumpir la toma de datos.

### ⚡ 5. Plantillas de Respuestas Rápidas
- Botones predefinidos en la interfaz de chat:
  - 📄 *Documentación a traer*
  - ⚖️ *Abogado en audiencia*
  - 💳 *Datos bancarios para consulta*
  - 📍 *Enviar ubicación GPS*
