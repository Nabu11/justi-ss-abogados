import { db } from './database.js';

export async function generateJustiResponse(conversationHistory, userMessage) {
  const settings = db.getSettings();
  const apiKey = settings.groqApiKey || process.env.GROQ_API_KEY;

  // Check Office Hours (Mendoza time UTC-3, Mon-Fri 8:00 - 20:00)
  const now = new Date();
  const utcHours = now.getUTCHours() - 3;
  const currentHour = utcHours < 0 ? utcHours + 24 : utcHours;
  const currentDay = now.getUTCDay(); // 0 is Sunday, 6 is Saturday
  const isOfficeHours = currentDay >= 1 && currentDay <= 5 && currentHour >= 8 && currentHour < 20;

  const officeHoursNote = isOfficeHours 
    ? "" 
    : "\nNOTA: Actualmente el estudio está fuera de su horario de atención (Lunes a Viernes de 8 a 20hs). Mencioná amablemente que de todos modos tomás sus datos ahora mismo para asignarle el primer turno disponible.";

  const systemPrompt = `Sos "Justi", la secretaria virtual del estudio jurídico S&S Abogados. Atendés consultas por WhatsApp en nombre del estudio (derecho civil, penal, laboral, familia, litigios contra el Estado y municipios).${officeHoursNote}

## REGLAS ESTRICTAS DE HORARIOS Y MODALIDADES
1. **Horario General de Atención**: Lunes a Viernes de 8:00 a 20:00 hs.
2. **Consultas Virtuales (Videollamada)**:
   - Se realizan en cualquier horario dentro del rango de Lunes a Viernes de 8:00 a 20:00 hs.
3. **Consultas Presenciales**:
   - Únicamente disponibles por la tarde: de **15:00 a 20:00 hs** (Lunes a Viernes).
   - Ubicación presencial según el día:
     - **VIERNES**: Presencial en la oficina fija del estudio (Capitán de Fragata Moyano 171, Piso 1, Mendoza).
     - **LUNES, MARTES, MIÉRCOLES Y JUEVES**: Presencial de 15 a 20hs con **lugar a confirmar** según disponibilidad del abogado.

## UBICACIÓN Y GPS
- Si preguntan por la ubicación o cómo llegar a la oficina, decí: "Nuestra oficina atiende los Viernes en Capitán de Fragata Moyano 171, Piso 1, Mendoza. 📍 Ver en Google Maps: https://maps.google.com/?q=-32.8988,-68.8475"

## FLUJO DE ATENCIÓN
1. Saludo inicial: Presentate como Justi de S&S Abogados.
2. Recolección de datos:
   - Nombre y apellido completo
   - Motivo/área de la consulta (civil, penal, laboral, familia, u otro)
   - Preferencia de modalidad: Virtual (Videollamada, 8 a 20hs) o Presencial (15 a 20hs; Viernes en oficina, Lunes a Jueves a confirmar lugar).
3. Confirmación de Cita:
   - Resumí los datos acordados indicando claramente la modalidad y lugar según el día.

## LÍMITES ESTRICTOS
- NO das asesoramiento legal ni opinás sobre fondos de casos.
- Tono cordial, formal pero cercano ("usted" o "vos" según el cliente). Respuestas cortas (2 a 4 líneas).`;

  if (!apiKey) {
    return getOfflineDemoResponse(userMessage, isOfficeHours, conversationHistory);
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
      return getOfflineDemoResponse(userMessage, isOfficeHours, conversationHistory);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'Hola, habla Justi de S&S Abogados. ¿En qué puedo ayudarte hoy?';
  } catch (error) {
    console.error('Error al llamar a Groq API via fetch:', error);
    return getOfflineDemoResponse(userMessage, isOfficeHours, conversationHistory);
  }
}

function getOfflineDemoResponse(userMessage, isOfficeHours, conversationHistory = []) {
  const msg = userMessage.toLowerCase();
  
  if (msg.includes('donde') || msg.includes('dónde') || msg.includes('direccion') || msg.includes('dirección') || msg.includes('como llego') || msg.includes('ubicacion') || msg.includes('ubicación')) {
    return 'Nuestra oficina atiende los Viernes en Capitán de Fragata Moyano 171, Piso 1, Mendoza. 📍 Abrir en Google Maps: https://maps.google.com/?q=-32.8988,-68.8475. (De Lunes a Jueves las citas presenciales son de 15 a 20hs en lugar a confirmar).';
  }

  if (msg.includes('urgente') || msg.includes('deten') || msg.includes('violencia') || msg.includes('polic') || msg.includes('preso') || msg.includes('echaron')) {
    return 'Entiendo la gravedad de la situación. Por tratarse de un asunto urgente, un abogado de S&S Abogados se comunicará con vos a la brevedad. Por favor confirmanos tu nombre completo.';
  }
  
  if (msg.includes('hola') || msg.includes('buenas') || msg.includes('dia') || msg.includes('tarde')) {
    const greetingExtra = isOfficeHours ? '' : ' Te aclaramos que estamos fuera del horario de atención (Lunes a Viernes de 8 a 20hs), pero con gusto tomamos tus datos.';
    return `¡Hola! Soy Justi, secretaria de S&S Abogados. 👋${greetingExtra} Ofrecemos consultas virtuales (8 a 20hs) y presenciales (15 a 20hs). ¿En qué podemos ayudarte hoy?`;
  }

  // Count past bot interactions in history to progress step-by-step
  const botMsgs = conversationHistory.filter(m => m.sender === 'bot');
  const lastBotMsg = botMsgs.length > 0 ? botMsgs[botMsgs.length - 1].text : '';

  if (lastBotMsg.includes('nombre') || lastBotMsg.includes('datos')) {
    return '¡Gracias por facilitarnos tus datos! ¿Preferís una consulta Virtual (videollamada de 8 a 20hs) o Presencial (de 15 a 20hs)? Si es presencial, los Viernes atendemos en la oficina y de Lunes a Jueves en lugar a confirmar.';
  }

  if (lastBotMsg.includes('virtual') || lastBotMsg.includes('presencial') || lastBotMsg.includes('cita')) {
    return 'Excelente. Quedó anotada tu solicitud de consulta. Un abogado del estudio se comunicará para confirmar la fecha y el lugar exacto. ¿Tenés alguna otra duda?';
  }

  if (msg.includes('horario') || msg.includes('atencion') || msg.includes('atención')) {
    return 'Nuestro horario de atención es de Lunes a Viernes de 8 a 20hs. Las consultas virtuales son de 8 a 20hs, y las presenciales son de 15 a 20hs (Viernes en oficina de Moyano 171, L-J lugar a confirmar).';
  }

  return '¡Gracias por escribir a S&S Abogados! Atendemos de Lunes a Viernes de 8 a 20hs. Para coordinar una consulta (Virtual 8-20hs o Presencial 15-20hs), ¿me decís tu nombre completo y motivo?';
}
