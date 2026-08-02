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
    ? `\nTURNOS ACTUALMENTE OCUPADOS EN AGENDA (1 hora de duración cada uno): ${occupiedSlots}. No ofrezcas ni confirmes estos horarios.`
    : '\nActualmente la agenda está libre. Ofrecé elegir día y hora dentro del horario de atención.';

  const officeHoursNote = isOfficeHours 
    ? "" 
    : "\nNOTA: Actualmente el estudio está fuera de su horario de atención presencial (Lunes a Viernes de 8 a 20hs). Mencioná amablemente que de todos modos tomás sus datos ahora mismo para asignarle el primer turno disponible.";

  const adminNote = isAdmin
    ? "\n💡 NOTA DE TESTEO INTERNO: Estás hablando por WhatsApp con Nahuel (titular/abogado del estudio S&S Abogados probando el sistema). Sé muy cordial, atenta y profesional. Si te saluda o hace preguntas de prueba, respondé como Justi demostrando tu funcionamiento."
    : "";

  const systemPrompt = `Sos "Justi", la secretaria virtual del estudio jurídico S&S Abogados. Atendés consultas por WhatsApp en nombre del estudio (derecho civil, penal, laboral, familia, litigios contra el Estado y municipios).${adminNote}${officeHoursNote}${occupiedNote}

## REGLAS ESTRICTAS DE HORARIOS, MODALIDADES Y TURNOS
1. **Duración de cada turno**: Cada consulta dura **1 hora exacta**.
2. **Disponibilidad de agenda**: Ofrecé al cliente elegir el día y la hora que prefiera, SIEMPRE QUE NO ESTÉ OCUPADO por otra cita agendada. Si pide un horario ocupado, aclarás amablemente que ya está reservado y ofrecés alternativas libres.
3. **Horario General de Atención**: Lunes a Viernes de 8:00 a 20:00 hs.
4. **Consultas Virtuales (Videollamada)**:
   - Se realizan en cualquier horario dentro del rango de Lunes a Viernes de 8:00 a 20:00 hs (turnos de 1 hora).
5. **Consultas Presenciales**:
   - Únicamente disponibles por la tarde: de **15:00 a 20:00 hs** (Lunes a Viernes, turnos de 1 hora).
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
   - Verificá que el horario de 1 hora esté libre y resumí los datos acordados.

## LÍMITES ESTRICTOS
- NO das asesoramiento legal ni opinás sobre fondos de casos.
- Tono cordial, formal pero cercano ("usted" o "vos" según el cliente). Respuestas cortas (2 a 4 líneas).`;

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
    return 'Nuestra oficina atiende los Viernes en Capitán de Fragata Moyano 171, Piso 1, Mendoza. 📍 Abrir en Google Maps: https://maps.google.com/?q=-32.8988,-68.8475. (De Lunes a Jueves las citas presenciales son de 15 a 20hs en lugar a confirmar).';
  }

  if (msg.includes('urgente') || msg.includes('deten') || msg.includes('violencia') || msg.includes('polic') || msg.includes('preso') || msg.includes('echaron')) {
    return 'Entiendo la gravedad de la situación. Por tratarse de un asunto urgente, un abogado de S&S Abogados se comunicará con vos a la brevedad. Por favor confirmanos tu nombre completo.';
  }
  
  if (msg.includes('hola') || msg.includes('buenas') || msg.includes('dia') || msg.includes('tarde')) {
    const greetingExtra = isOfficeHours ? '' : ' Te aclaramos que estamos fuera del horario de atención (Lunes a Viernes de 8 a 20hs), pero con gusto tomamos tus datos.';
    return `¡Hola! Soy Justi, secretaria de S&S Abogados. 👋${greetingExtra} Los turnos son de 1 hora: Virtuales (8 a 20hs) o Presenciales (15 a 20hs). ¿En qué podemos ayudarte hoy?`;
  }

  const botMsgs = conversationHistory.filter(m => m.sender === 'bot');
  const lastBotMsg = botMsgs.length > 0 ? botMsgs[botMsgs.length - 1].text : '';

  if (lastBotMsg.includes('nombre') || lastBotMsg.includes('datos')) {
    return '¡Gracias por facilitarnos tus datos! ¿Preferís una consulta Virtual (videollamada 8-20hs) o Presencial (15-20hs, turnos de 1 hora)? Indicame qué día y hora te vendría mejor.';
  }

  if (lastBotMsg.includes('virtual') || lastBotMsg.includes('presencial') || lastBotMsg.includes('hora')) {
    return 'Excelente. Quedó registrado tu pedido para la consulta de 1 hora. Un abogado del estudio confirmará el turno libre a la brevedad. ¿Tenés alguna otra duda?';
  }

  if (msg.includes('horario') || msg.includes('atencion') || msg.includes('atención')) {
    return 'Nuestro horario de atención es de L-V de 8 a 20hs. Cada turno dura 1 hora: Virtuales (8 a 20hs) y Presenciales (15 a 20hs, Viernes en oficina de Moyano 171, L-J a confirmar).';
  }

  return '¡Gracias por escribir a S&S Abogados! Ofrecemos turnos libres de 1 hora (Virtual 8-20hs / Presencial 15-20hs). ¿Me decís tu nombre completo y preferencia de día y hora?';
}
