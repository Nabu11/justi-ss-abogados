import fetch from 'node-fetch';

async function main() {
  const response = await fetch('http://localhost:3000/api/simulate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer sys-token-secret-2026'
    },
    body: JSON.stringify({
      message: '🚨 URGENTE: Tienen detenido a mi hermano en la comisaría 3ra y necesitamos asistencia inmediata de un abogado penalista.'
    })
  });
  const data = await response.json();
  console.log('Respuesta recibida:', data);
}

main();
