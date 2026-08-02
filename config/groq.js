import { db } from './database.js';

export async function generateJustiResponse(conversationHistory, userMessage, isAdmin = false) {
  const settings = db.getSettings();
  const apiKey = settings.groqApiKey || process.env.GROQ_API_KEY;

  // Check Office Hours (Mendoza time UTC-3, Mon-Fri 8:00 - 20:00)
  const now = new Date();
  const utcHours = now.getUTCHours() - 3;
  const currentHour = utcHours < 0 ? utcHours + 24 : utcHours;
  const currentDay = now.getUTCDay(); // 0 is Sunday, 6 is Saturday
  const isOfficeHours = currentDay >= 1 && currentDay <= 5 && currentHour >= 8 && currentHour < 20;

  // Fetch occupied appointments from DB to prevent double booking
  const existingApts = db.getAppointments();
  const occupiedSlots = existingApts
    .filter(a => a.status === 'confirmado' || a.status === 'pendiente')
    .map(a => `${a.date} a las ${a.time}hs (${a.modality})`)
    .join(', ');

  const occupiedNote = occupiedSlots 
    ? `\nTURNOS ACTUALMENTE OCUPADOS EN AGENDA: ${occupiedSlots}. No confirmes estos horarios.`
    : '';

  const officeHoursNote = isOfficeHours 
    ? "" 
    : "\nNOTA: Actualmente el estudio está fuera de su horario habitual. Mencioná amablemente que de todos modos tomás sus datos ahora mismo.";

  const adminNote = isAdmin
    ? "\n💡 NOTA DE TESTEO INTERNO: Estás hablando por WhatsApp con Nahuel (titular/abogado del estudio S&S Abogados probando el sistema). Sé muy cordial, atenta y profesional. Respondé como Justi demostrando tu funcionamiento."
    : "";

  const systemPrompt = `Sos "Justi", la secretaria virtual del estudio jurídico S&S Abogados. Atendés consultas por WhatsApp en nombre del estudio (derecho civil, penal, laboral, familia, litigios contra el Estado y municipios).${adminNote}${officeHoursNote}${occupiedNote}

## REGLA CRÍTICA DE COMUNICACIÓN NATURAL (MUY IMPORTANTE)
- **NO expliques ni menciones espontáneamente los horarios de atención ni la duración de las citas (1 hora) al inicio**.
- Mantené la charla natural y directa: saludá, preguntá el nombre y el motivo de la consulta.
- SÓLO mencioná los horarios (L-V 8 a 20hs; presenciales 15 a 20hs) o la duración de 1 hora si el cliente lo pregunta explícitamente (ej: "¿En qué horario atienden?", "¿Cuánto dura?") o cuando estén coordinando el día y la hora de la cita.

## DATOS INTERNOS DE HORARIOS Y MODALIDADES (USAR SÓLO SI EL CLIENTE PREGUNTA O PARA COORDINAR)
1. **Duración de cada turno**: 1 hora exacta.
2. **Horario General**: Lunes a Viernes de 8:00 a 20:00 hs.
3. **Consultas Virtuales (Videollamada)**: De Lunes a Viernes de 8:00 a 20:00 hs.
4. **Consultas Presenciales**: De Lunes a Viernes de 15:00 a 20:00 hs.
   - **Viernes**: En la oficina fija (Capitán de Fragata Moyano 171, Piso 1, Mendoza).
   - **Lunes a Jueves**: En lugar a confirmar según la disponibilidad del abogado.

## UBICACIÓN Y GPS
- Si preguntan por la ubicación o cómo llegar a la oficina, decí: "Nuestra oficina atiende los Viernes en Capitán de Fragata Moyano 171, Piso 1, Mendoza. 📍 Ver en Google Maps: https://maps.google.com/?q=-32.8988,-68.8475"

## FLUJO DE ATENCIÓN NATURAL
1. Saludo inicial breve y amable (ej: "¡Hola! Soy Justi de S&S Abogados. 👋 ¿En qué podemos ayudarte hoy?").
2. Recolección limpia de datos (Nombre, motivo/área y si prefiere consulta presencial o virtual).
3. Coordinación de fecha y hora libre.

## LÍMITES ESTRICTOS
- NO das asesoramiento legal ni opinás sobre fondos de casos.
- Tono cordial, formal pero cercano. Respuestas cortas y despejadas (2 a 3 líneas).`;

  if (!apiKey) {
    return getOfflineDemoResponse(userMessage, isOfficeHours, conversationHistory, existingApts, isAdmin);
  }

  try {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.map(m => ({
        role: m.sender === 'client' ? 'user' : 'assistant',
        content: m.text
      })),
      { role: 'user', content: userMessage }
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: settings.model || 'llama-3.3-70b-versatile',
        messages: messages,
        temperature: 0.4,
        max_tokens: 300
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Groq API Error:', response.status, errText);
      return getOfflineDemoResponse(userMessage, isOfficeHours, conversationHistory, existingApts, isAdmin);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'Hola, habla Justi de S&S Abogados. ¿En qué puedo ayudarte hoy?';
  } catch (error) {
    console.error('Error al llamar a Groq API via fetch:', error);
    return getOfflineDemoResponse(userMessage, isOfficeHours, conversationHistory, existingApts, isAdmin);
  }
}

function getOfflineDemoResponse(userMessage, isOfficeHours, conversationHistory = [], existingApts = [], isAdmin = false) {
  const msg = userMessage.toLowerCase();

  if (isAdmin && (msg.includes('hola') || msg.includes('test') || msg.includes('prueba'))) {
    return '¡Hola Nahuel! 👋 Modo de testeo activo para tu línea de S&S Abogados. Podés escribirme cualquier consulta de prueba o usar los comandos como !limpiar, !turnos o !status.';
  }
  
  if (msg.includes('donde') || msg.includes('dónde') || msg.includes('direccion') || msg.includes('dirección') || msg.includes('como llego') || msg.includes('ubicacion') || msg.includes('ubicación')) {
    return 'Nuestra oficina atiende los Viernes en Capitán de Fragata Moyano 171, Piso 1, Mendoza. 📍 Abrir en Google Maps: https://maps.google.com/?q=-32.8988,-68.8475';
  }

  if (msg.includes('urgente') || msg.includes('deten') || msg.includes('violencia') || msg.includes('polic') || msg.includes('preso') || msg.includes('echaron')) {
    return 'Entiendo la gravedad de la situación. Por tratarse de un asunto urgente, un abogado de S&S Abogados se comunicará con vos a la brevedad. Por favor confirmanos tu nombre completo.';
  }
  
  if (msg.includes('hola') || msg.includes('buenas') || msg.includes('dia') || msg.includes('tarde')) {
    return `¡Hola! Soy Justi, secretaria virtual de S&S Abogados. 👋 ¿En qué podemos ayudarte hoy?`;
  }

  const botMsgs = conversationHistory.filter(m => m.sender === 'bot');
  const lastBotMsg = botMsgs.length > 0 ? botMsgs[botMsgs.length - 1].text : '';

  if (lastBotMsg.includes('ayudarte') || lastBotMsg.includes('motivo')) {
    return 'Con gusto tomamos tu consulta. Para coordinar la atención con el abogado, ¿me decís tu nombre completo y si preferís consulta Presencial o Virtual (videollamada)?';
  }

  if (lastBotMsg.includes('nombre') || lastBotMsg.includes('presencial') || lastBotMsg.includes('virtual')) {
    return '¡Perfecto! Quedó anotado. ¿Qué día y horario te vendría bien para coordinar la cita?';
  }

  if (msg.includes('horario') || msg.includes('atencion') || msg.includes('atención') || msg.includes('duracion') || msg.includes('duración') || msg.includes('cuanto dura')) {
    return 'Nuestro horario de atención es de L-V de 8 a 20hs (consultas virtuales de 8 a 20hs y presenciales de 15 a 20hs). Cada turno tiene una duración de 1 hora.';
  }

  return '¡Gracias por escribir a S&S Abogados! Para agendar una consulta con el equipo, ¿me indicás tu nombre completo y motivo?';
}
