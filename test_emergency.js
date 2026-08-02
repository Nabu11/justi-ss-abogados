import { processIncomingMessage } from './bot/justiEngine.js';

async function runTest() {
  console.log('🧪 Iniciando prueba de Alerta de Emergencia Penal...');
  const result = await processIncomingMessage(
    '5492615559988@s.whatsapp.net',
    'Juan Pérez (Test Penal)',
    '🚨 EMERGENCIA PENAL: Tienen detenido a mi hermano en la comisaría 3ra de Mendoza y necesitamos asistencia urgente de un abogado penalista.'
  );
  console.log('\n🤖 RESPUESTA QUE RECIBIRÍA EL CLIENTE:\n', result);
}

runTest();
