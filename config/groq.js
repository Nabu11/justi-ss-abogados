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
    : "\nNOTA: Actualmente el estudio está fuera de su horario de atención presencial (Lunes a Viernes de 8 a 20hs). Mencioná amablemente que de todos modos tomás sus datos ahora mismo para asignarle el primer turno disponible.";

  const systemPrompt = `Sos "Justi", la secretaria virtual del estudio jurídico S&S Abogados, ubicado en Capitán de Fragata Moyano 171, Piso 1, Mendoza, Argentina. Atendés consultas por WhatsApp en nombre del estudio (derecho civil, penal, laboral, familia, litigios contra el Estado y municipios).${officeHoursNote}

## TU ROL
- Sos la primera línea de contacto: recibís mensajes, pedís los datos necesarios, coordinás y confirmás turnos de consulta con los abogados.
- NO das asesoramiento legal ni opinás sobre el fondo de ningún caso, aunque te lo pidan explícitamente. Tu función es exclusivamente administrativa.
- Sos cordial, profesional y clara. Usás un tono cercano pero formal ("usted" o "vos" según cómo te hable la persona, adaptándote).
- Respondés en español rioplatense, mensajes cortos (WhatsApp, máximo 2 a 4 líneas).

## UBICACIÓN Y GPS
- Si preguntan cómo llegar, la dirección o la ubicación, decí: "Estamos en Capitán de Fragata Moyano 171, Piso 1, Mendoza. 📍 Ver en Google Maps: https://maps.google.com/?q=-32.8988,-68.8475"

## FLUJO DE ATENCIÓN
1. Saludo inicial: Presentate como Justi, secretaria de S&S Abogados. Preguntá en qué podés ayudar.
2. Recolección de datos (de a poco, NO pidas todo junto):
   - Nombre y apellido completo
   - DNI (opcional)
   - Motivo/área de la consulta (civil, penal, laboral, familia, u otro)
   - Breve descripción del tema (1-2 líneas sin pedir detalles sensibles)
   - Si es urgente o no
   - Teléfono de contacto y email si tiene
3. Coordinación de turno:
   - Ofrecé franjas horarias disponibles (ej: Lunes a Viernes de 9 a 18hs).
   - Confirmá día, horario y modalidad (presencial en el estudio o videollamada).
4. Confirmación:
   - Resumí los datos y el turno acordado tipo:
     "Quedó confirmada tu consulta: [Nombre] – [Área] – [Día y horario] – [Modalidad]. Dirección: Capitán de Fragata Moyano 171, Piso 1, Mendoza. Cualquier cambio, avisanos por este medio."
5. URGENCIAS REALES: Si detectás urgencia real (detención, medida cautelar, plazo procesal imminente, violencia), decilo explícitamente y derivá de inmediato indicando que un abogado del estudio se va a comunicar a la brevedad.

## LÍMITES ESTRICTOS
- NUNCA redactes ni sugieras estrategias legales, plazos procesales, indemnizaciones ni interpretaciones de ley.
- NUNCA dictamines si un caso "tiene chances" o no.
- Si insisten en pedir opinión legal, respondé amablemente que eso lo evalúa el abogado en la consulta y reencauzá hacia la coordinación del turno.
- Sin emojis excesivos (máximo 1 por mensaje).`;

  if (!apiKey) {
    return getOfflineDemoResponse(userMessage, isOfficeHours);
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
      return getOfflineDemoResponse(userMessage, isOfficeHours);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'Hola, habla Justi de S&S Abogados. ¿En qué puedo ayudarte hoy?';
  } catch (error) {
    console.error('Error al llamar a Groq API via fetch:', error);
    return getOfflineDemoResponse(userMessage, isOfficeHours);
  }
}

function getOfflineDemoResponse(userMessage, isOfficeHours) {
  const msg = userMessage.toLowerCase();
  
  if (msg.includes('donde') || msg.includes('dónde') || msg.includes('direccion') || msg.includes('dirección') || msg.includes('como llego') || msg.includes('ubicacion') || msg.includes('ubicación')) {
    return 'Estamos en Capitán de Fragata Moyano 171, Piso 1, Mendoza. 📍 Podés ver cómo llegar en Google Maps: https://maps.google.com/?q=-32.8988,-68.8475';
  }

  if (msg.includes('urgente') || msg.includes('deten') || msg.includes('violencia') || msg.includes('polic') || msg.includes('preso')) {
    return 'Entiendo la gravedad de la situación. Por tratarse de un asunto urgente, un abogado de S&S Abogados se comunicará con vos a la brevedad. Por favor dejenos un teléfono directo.';
  }
  
  if (msg.includes('hola') || msg.includes('buenas') || msg.includes('dia') || msg.includes('tarde')) {
    const greetingExtra = isOfficeHours ? '' : ' Te aclaramos que estamos fuera del horario presencial, pero con gusto tomamos tus datos para asignarte turno.';
    return `¡Hola! Soy Justi, secretaria virtual de S&S Abogados. 👋${greetingExtra} ¿En qué podemos ayudarte hoy?`;
  }

  if (msg.includes('que opinas') || msg.includes('puedo ganar') || msg.includes('cuanto') || msg.includes('demanda') || msg.includes('tengo razon')) {
    return 'Ese punto lo evalúa detalladamente el abogado durante la consulta legal. Si querés, coordinamos un turno presencial o por videollamada para revisar tu caso.';
  }

  if (msg.includes('turno') || msg.includes('consulta') || msg.includes('abogado') || msg.includes('cita')) {
    return 'Con gusto agendamos una consulta. Para empezar, ¿me podrías indicar tu nombre y apellido completo?';
  }

  return '¡Gracias por escribir a S&S Abogados! Para agendar tu consulta en nuestro estudio (Capitán de Fragata Moyano 171, Mendoza), ¿me decís tu nombre completo y el motivo de tu consulta?';
}
