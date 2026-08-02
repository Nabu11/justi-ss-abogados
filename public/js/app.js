// Global State
let state = {
  currentTab: 'dashboard',
  appointments: [],
  chats: [],
  documents: [],
  activeChatPhone: null,
  simMessages: [
    { sender: 'bot', text: '¡Hola! Soy Justi, secretaria virtual de S&S Abogados. 👋 ¿En qué podemos ayudarte hoy?', timestamp: new Date().toISOString() }
  ],
  whatsappStatus: 'disconnected',
  soundEnabled: true
};

// Web Audio API Synthesizer (Zero External Dependencies)
function playAlertChime() {
  if (!state.soundEnabled) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    // First note (G5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(783.99, ctx.currentTime);
    gain1.gain.setValueAtTime(0.15, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.3);

    // Second note (C6)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1046.50, ctx.currentTime + 0.15);
    gain2.gain.setValueAtTime(0.2, ctx.currentTime + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.15);
    osc2.stop(ctx.currentTime + 0.5);
  } catch (e) {
    // Audio context allowed after user interaction
  }
}

// Request Desktop Notification Permission
if ('Notification' in window && Notification.permission !== 'granted') {
  Notification.requestPermission();
}

function showDesktopNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '🏛️' });
  }
}

// Auth Fetch Wrapper
async function authFetch(url, options = {}) {
  const token = localStorage.getItem('justi_auth_token');
  if (!token && !url.includes('/login')) {
    window.location.href = '/login.html';
    return;
  }

  options.headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`
  };

  const response = await fetch(url, options);
  if (response.status === 401) {
    localStorage.removeItem('justi_auth_token');
    window.location.href = '/login.html';
    return;
  }
  return response;
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupEvents();
  setupMobileDrawer();
  fetchInitialData();
  connectWhatsAppSSE();
  pollWhatsAppQR();
  renderSimulator();
});

// Navigation Setup
function setupNavigation() {
  const navButtons = document.querySelectorAll('.nav-item');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });
}

function setupMobileDrawer() {
  const sidebar = document.getElementById('app-sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const btnOpenSidebar = document.getElementById('btn-toggle-sidebar');
  const btnCloseSidebar = document.getElementById('btn-close-sidebar');

  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('active');
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
  }

  if (btnOpenSidebar) btnOpenSidebar.addEventListener('click', openSidebar);
  if (btnCloseSidebar) btnCloseSidebar.addEventListener('click', closeSidebar);
  if (overlay) overlay.addEventListener('click', closeSidebar);
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('app-sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('active');
}

function switchTab(tabName) {
  state.currentTab = tabName;
  closeMobileSidebar();

  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(t => {
    t.classList.toggle('active', t.id === `tab-${tabName}`);
  });

  const titles = {
    dashboard: '¡Hola! Bienvenido al centro de control 👋',
    appointments: '📅 Gestor de Turnos & Citas',
    chats: '💬 Conversaciones de WhatsApp',
    documents: '📂 Galería de Documentos Recibidos',
    analytics: '📈 Reportes & Métricas',
    simulator: '🤖 Probador Interactivo de Justi (Simulador WhatsApp)',
    settings: '⚙️ Configuración del Sistema'
  };
  document.getElementById('page-title').innerText = titles[tabName] || '¡Hola! Bienvenido al centro de control 👋';

  if (tabName === 'analytics') {
    fetchAnalytics();
  } else if (tabName === 'documents') {
    fetchDocuments();
  }
}

// Events Setup
function setupEvents() {
  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('justi_auth_token');
    window.location.href = '/login.html';
  });

  // Sound Toggle
  document.getElementById('btn-toggle-sound').addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    const btn = document.getElementById('btn-toggle-sound');
    btn.innerText = state.soundEnabled ? '🔔 Sonido: ON' : '🔕 Sonido: OFF';
  });

  // Export CSV
  document.getElementById('btn-export-csv').addEventListener('click', exportToCSV);

  // Print PDF
  document.getElementById('btn-print-pdf').addEventListener('click', () => {
    switchTab('appointments');
    setTimeout(() => window.print(), 300);
  });

  // New Appointment Modal (Main & Tab Buttons)
  const openModal = () => {
    document.getElementById('modal-apt').style.display = 'flex';
  };
  document.getElementById('btn-new-apt').addEventListener('click', openModal);
  const btnNewAptTab = document.getElementById('btn-new-apt-tab');
  if (btnNewAptTab) btnNewAptTab.addEventListener('click', openModal);

  document.getElementById('btn-close-modal').addEventListener('click', () => {
    document.getElementById('modal-apt').style.display = 'none';
  });
  document.getElementById('btn-cancel-modal').addEventListener('click', () => {
    document.getElementById('modal-apt').style.display = 'none';
  });

  // Submit New Appointment (Manual or External Client)
  document.getElementById('form-new-apt').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newApt = {
      clientName: document.getElementById('apt-name').value,
      dni: document.getElementById('apt-dni').value,
      area: document.getElementById('apt-area').value,
      modality: document.getElementById('apt-modality').value,
      date: document.getElementById('apt-date').value,
      time: document.getElementById('apt-time').value,
      phone: document.getElementById('apt-phone').value,
      description: document.getElementById('apt-desc').value || 'Turno registrado manualmente',
      isUrgent: document.getElementById('apt-urgent').checked,
      status: 'confirmado'
    };

    try {
      const res = await authFetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newApt)
      });
      const data = await res.json();
      if (data.success) {
        document.getElementById('modal-apt').style.display = 'none';
        document.getElementById('form-new-apt').reset();
        await fetchAppointments();
        alert('✅ Cita agendada correctamente.');
      }
    } catch (err) {
      alert('Error guardando el turno');
    }
  });

  // Manual Chat Message Send
  document.getElementById('btn-send-manual').addEventListener('click', sendManualChatMessage);
  document.getElementById('input-manual-msg').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendManualChatMessage();
  });

  // Filters for Appointments
  document.querySelectorAll('.btn-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderAppointmentsTable(btn.getAttribute('data-filter'));
    });
  });

  // Search Appointments
  document.getElementById('search-apts').addEventListener('input', (e) => {
    renderAppointmentsTable('all', e.target.value.toLowerCase());
  });

  // Simulator Send Button
  document.getElementById('btn-send-sim').addEventListener('click', sendSimulatedMessage);
  document.getElementById('input-sim-msg').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendSimulatedMessage();
  });
  document.getElementById('btn-reset-sim').addEventListener('click', () => {
    state.simMessages = [
      { sender: 'bot', text: '¡Hola! Soy Justi, secretaria virtual de S&S Abogados. 👋 ¿En qué podemos ayudarte hoy?', timestamp: new Date().toISOString() }
    ];
    renderSimulator();
  });

  // Clear Database Event
  const btnClearDb = document.getElementById('btn-clear-db');
  if (btnClearDb) {
    btnClearDb.addEventListener('click', async () => {
      if (confirm('¿Estás seguro de que deseas eliminar todos los turnos y chats guardados?')) {
        await authFetch('/api/admin/clear-data', { method: 'POST' });
        await fetchInitialData();
        alert('Se han eliminado todos los datos correctamente. ✅');
      }
    });
  }

  // Save Settings
  document.getElementById('form-settings-groq').addEventListener('submit', async (e) => {
    e.preventDefault();
    const groqApiKey = document.getElementById('groq-key-input').value;
    const model = document.getElementById('groq-model-select').value;
    const autoRemindersEnabled = document.getElementById('chk-auto-reminders').checked;
    
    await authFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groqApiKey, model, autoRemindersEnabled })
    });
    alert('Ajustes guardados correctamente ✅');
  });
}

// Fetch Received Documents
async function fetchDocuments() {
  try {
    const res = await authFetch('/api/documents');
    if (!res) return;
    state.documents = await res.json();
    renderDocumentsTable();
  } catch (err) {
    console.error('Error cargando documentos:', err);
  }
}

function renderDocumentsTable() {
  const tbody = document.getElementById('documents-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (state.documents.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#9ca3af; padding:20px;">📂 No se han recibido adjuntos o PDFs por WhatsApp aún</td></tr>';
    return;
  }

  state.documents.forEach(doc => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>📄 ${doc.filename}</strong></td>
      <td>${doc.size}</td>
      <td>${new Date(doc.date).toLocaleString()}</td>
      <td>
        <a href="${doc.url}" target="_blank" class="btn-icon">📥 Ver / Descargar Documento</a>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Preset Test Scenario Runner for Simulator
async function runSimScenario(type) {
  const scenarioTexts = {
    urgent: 'Buenas tardes, tuvieron detenido a mi hermano en la comisaría 3ra y necesitamos asistencia penal urgente.',
    presencial: 'Hola, quisiera agendar un turno presencial en la oficina para este Viernes a las 16hs por un tema civil.',
    virtual: 'Buenas, necesito coordinar una consulta por Videollamada el próximo Martes a las 11hs por una consulta laboral.',
    gps: 'Hola, ¿dónde queda exactamente la oficina del estudio y cómo hago para llegar?',
    offhours: 'Buenas noches, escribo para consultar por un despido e indemnización laboral.'
  };

  const text = scenarioTexts[type];
  if (!text) return;

  const input = document.getElementById('input-sim-msg');
  input.value = text;
  sendSimulatedMessage();
}

// Quick Templates for Chat
function insertQuickTemplate(type) {
  const input = document.getElementById('input-manual-msg');
  if (input.disabled) return;

  const templates = {
    doc: 'Recordá asistir a la consulta con tu DNI original y toda la documentación pertinente sobre tu caso.',
    audiencia: 'El abogado a cargo se encuentra en audiencia en este momento. Nos comunicaremos con vos a la brevedad.',
    cbu: 'Los datos bancarios para abonar la consulta son: CBU 0110000000000000000000 / Alias: SYS.ABOGADOS.MENDOZA',
    gps: 'Nuestra ubicación exacta es Capitán de Fragata Moyano 171, Piso 1, Mendoza. 📍 Abrir en Google Maps: https://maps.google.com/?q=-32.8988,-68.8475'
  };

  input.value = templates[type] || '';
  input.focus();
}

async function sendManualChatMessage() {
  const input = document.getElementById('input-manual-msg');
  const text = input.value.trim();
  if (!text || !state.activeChatPhone) return;

  try {
    const res = await authFetch(`/api/chats/${state.activeChatPhone}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (data.success) {
      input.value = '';
      await fetchChats();
      selectChat(state.activeChatPhone);
    }
  } catch (err) {
    alert('Error enviando mensaje');
  }
}

// Data Fetching
async function fetchInitialData() {
  await Promise.all([fetchAppointments(), fetchChats(), fetchSettings()]);
}

async function fetchAppointments() {
  try {
    const res = await authFetch('/api/appointments');
    if (!res) return;
    state.appointments = await res.json();
    updateStats();
    renderDashboardTable();
    renderAppointmentsTable();
  } catch (err) {
    console.error('Error cargando turnos:', err);
  }
}

async function fetchChats() {
  try {
    const res = await authFetch('/api/chats');
    if (!res) return;
    const newChats = await res.json();

    // Check if new urgent chat arrived
    const hasNewUrgent = newChats.some(nc => nc.isUrgent && (!state.chats.find(oc => oc.phone === nc.phone) || !state.chats.find(oc => oc.phone === nc.phone).isUrgent));
    if (hasNewUrgent) {
      playAlertChime();
      showDesktopNotification('🚨 Alerta S&S Abogados', 'Se ha registrado un caso urgente por WhatsApp.');
    }

    state.chats = newChats;
    renderChatList();
  } catch (err) {
    console.error('Error cargando chats:', err);
  }
}

async function fetchSettings() {
  try {
    const res = await authFetch('/api/settings');
    if (!res) return;
    const settings = await res.json();
    if (settings.groqApiKey) {
      document.getElementById('groq-key-input').value = settings.groqApiKey;
    }
    if (settings.model) {
      document.getElementById('groq-model-select').value = settings.model;
    }
    if (settings.autoRemindersEnabled !== undefined) {
      document.getElementById('chk-auto-reminders').checked = settings.autoRemindersEnabled;
    }
  } catch (err) {
    console.error('Error cargando ajustes:', err);
  }
}

async function fetchAnalytics() {
  try {
    const res = await authFetch('/api/analytics');
    if (!res) return;
    const data = await res.json();
    renderAnalyticsCharts(data);
  } catch (err) {
    console.error('Error cargando analíticas:', err);
  }
}

function renderAnalyticsCharts(data) {
  const areaContainer = document.getElementById('analytics-area-container');
  const modContainer = document.getElementById('analytics-modality-container');

  const totalApts = data.totalAppointments || 1;
  const areaEntries = Object.entries(data.areaBreakdown || {});
  
  if (areaEntries.length === 0) {
    areaContainer.innerHTML = '<p style="color:#9ca3af; text-align:center;">No hay suficientes datos aún.</p>';
  } else {
    let areaHtml = '<div class="bar-chart-list">';
    areaEntries.forEach(([area, count]) => {
      const pct = Math.round((count / totalApts) * 100);
      areaHtml += `
        <div class="bar-item">
          <div class="bar-info">
            <span><strong>${area}</strong></span>
            <span>${count} citas (${pct}%)</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width: ${pct}%;"></div>
          </div>
        </div>
      `;
    });
    areaHtml += '</div>';
    areaContainer.innerHTML = areaHtml;
  }

  const modEntries = Object.entries(data.modalityBreakdown || {});
  let modHtml = '<div class="bar-chart-list">';
  modEntries.forEach(([mod, count]) => {
    const pct = totalApts > 0 ? Math.round((count / totalApts) * 100) : 0;
    modHtml += `
      <div class="bar-item">
        <div class="bar-info">
          <span><strong>${mod}</strong></span>
          <span>${count} citas (${pct}%)</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill blue" style="width: ${pct}%;"></div>
        </div>
      </div>
    `;
  });
  modHtml += '</div>';
  modContainer.innerHTML = modHtml;
}

// Export Appointments to CSV
function exportToCSV() {
  if (state.appointments.length === 0) {
    alert('No hay turnos para exportar.');
    return;
  }

  let csvContent = 'data:text/csv;charset=utf-8,ID,Cliente,DNI,Area,Fecha,Hora,Modalidad,Telefono,Urgente,Estado\n';
  state.appointments.forEach(a => {
    const row = [
      a.id,
      `"${a.clientName}"`,
      a.dni || '',
      `"${a.area}"`,
      a.date,
      a.time,
      a.modality,
      a.phone,
      a.isUrgent ? 'SI' : 'NO',
      a.status
    ].join(',');
    csvContent += row + '\n';
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `turnos_sysabogados_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Generate Google Calendar Link
function getGoogleCalendarUrl(apt) {
  const title = encodeURIComponent(`Consulta S&S Abogados - ${apt.clientName}`);
  const details = encodeURIComponent(`Consulta legal (${apt.area}). Cliente: ${apt.clientName}, Tel: ${apt.phone}. Modalidad: ${apt.modality}.`);
  const location = encodeURIComponent('Capitán de Fragata Moyano 171, Piso 1, Mendoza, Argentina');
  const dateClean = (apt.date || '2026-08-03').replace(/-/g, '');
  const timeClean = (apt.time || '16:00').replace(':', '') + '00';
  const dtStart = `${dateClean}T${timeClean}`;

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}&location=${location}&dates=${dtStart}/${dtStart}`;
}

// Update Stats UI
function updateStats() {
  const total = state.appointments.length;
  const urgent = state.appointments.filter(a => a.isUrgent).length;
  document.getElementById('stat-total-apts').innerText = total;
  document.getElementById('stat-urgent-apts').innerText = urgent;
  document.getElementById('stat-active-chats').innerText = state.chats.length;
  document.getElementById('badge-appointments-count').innerText = total;
}

// Dashboard Recent Appointments Table
function renderDashboardTable() {
  const tbody = document.querySelector('#table-dash-apts tbody');
  tbody.innerHTML = '';
  const recent = state.appointments.slice(0, 5);
  if (recent.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#9ca3af; padding:20px;">☀️ ¡Todo al día! No hay turnos agendados por ahora</td></tr>';
    return;
  }

  recent.forEach(a => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${a.clientName}</strong></td>
      <td>${a.area}</td>
      <td>${a.date} ${a.time}hs</td>
      <td>${a.modality}</td>
      <td><span class="badge badge-${a.status}">${a.status}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// All Appointments Table Render
function renderAppointmentsTable(filter = 'all', searchQuery = '') {
  const tbody = document.getElementById('apts-tbody');
  tbody.innerHTML = '';

  let filtered = state.appointments;
  if (filter !== 'all') {
    filtered = filtered.filter(a => a.status === filter);
  }

  if (searchQuery) {
    filtered = filtered.filter(a => 
      a.clientName.toLowerCase().includes(searchQuery) ||
      (a.dni && a.dni.includes(searchQuery)) ||
      a.phone.includes(searchQuery)
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#9ca3af; padding:20px;">☀️ No hay turnos registrados con ese criterio</td></tr>';
    return;
  }

  filtered.forEach(a => {
    const gCalUrl = getGoogleCalendarUrl(a);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${a.clientName}</strong><br><small style="color:#9ca3af;">DNI: ${a.dni || 'S/D'}</small></td>
      <td><strong>${a.area}</strong><br><small style="color:#9ca3af;">${a.description || ''}</small></td>
      <td>${a.date}<br><small style="color:#eab308; font-weight:600;">${a.time} hs</small></td>
      <td>📱 ${a.phone}</td>
      <td>${a.isUrgent ? '<span class="badge badge-urgent">🚨 URGENTE</span>' : 'Normal'}</td>
      <td>${a.modality}</td>
      <td><span class="badge badge-${a.status}">${a.status}</span></td>
      <td>
        <div class="action-btn-group">
          <select class="form-control" style="padding:4px; font-size:11px; width:100px;" onchange="changeStatus('${a.id}', this.value)">
            <option value="pendiente" ${a.status === 'pendiente' ? 'selected' : ''}>Pendiente</option>
            <option value="confirmado" ${a.status === 'confirmado' ? 'selected' : ''}>Confirmado</option>
            <option value="atendido" ${a.status === 'atendido' ? 'selected' : ''}>Atendido</option>
            <option value="cancelado" ${a.status === 'cancelado' ? 'selected' : ''}>Cancelado</option>
          </select>
          <a href="${gCalUrl}" target="_blank" class="btn-icon" title="Agregar a Google Calendar">📅 GCal</a>
          <a href="/api/appointments/${a.id}/ics" class="btn-icon" title="Descargar .ics para Outlook/Apple Calendar">📥 .ics</a>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function changeStatus(id, newStatus) {
  try {
    await authFetch(`/api/appointments/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    await fetchAppointments();
  } catch (err) {
    alert('Error actualizando estado del turno');
  }
}

// Render Chat Inbox
function renderChatList() {
  const container = document.getElementById('chat-items-list');
  container.innerHTML = '';

  if (state.chats.length === 0) {
    container.innerHTML = '<div style="padding:20px; text-align:center; color:#9ca3af; font-size:13px;">No hay conversaciones activas aún</div>';
    return;
  }

  state.chats.forEach(chat => {
    const item = document.createElement('div');
    item.className = `chat-item ${state.activeChatPhone === chat.phone ? 'active' : ''}`;
    item.onclick = () => selectChat(chat.phone);
    item.innerHTML = `
      <div class="chat-item-header">
        <span class="chat-item-name">${chat.pushName}</span>
        <span class="chat-item-time">${new Date(chat.lastMessageTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
      </div>
      <div class="chat-item-preview">${chat.isUrgent ? '🚨 URGENTE - ' : ''}${chat.lastMessage}</div>
    `;
    container.appendChild(item);
  });
}

function selectChat(phone) {
  state.activeChatPhone = phone;
  const chat = state.chats.find(c => c.phone === phone);
  if (!chat) return;

  document.getElementById('active-chat-name').innerText = chat.pushName;
  document.getElementById('active-chat-phone').innerText = chat.phone;
  document.getElementById('input-manual-msg').disabled = false;
  document.getElementById('btn-send-manual').disabled = false;

  const btnPause = document.getElementById('btn-toggle-bot');
  btnPause.innerText = chat.pausedBot ? '▶ Reanudar Bot' : '⏸ Pausar Bot';
  btnPause.onclick = () => toggleBotPause(phone, !chat.pausedBot);

  renderMessages(chat.messages || []);
  renderChatList();
}

function renderMessages(messages) {
  const container = document.getElementById('messages-container');
  container.innerHTML = '';

  if (messages.length === 0) {
    container.innerHTML = '<div class="empty-state"><span>💬</span><p>No hay mensajes en esta conversación.</p></div>';
    return;
  }

  messages.forEach(m => {
    const row = document.createElement('div');
    let senderType = m.sender; // 'client', 'bot', 'admin'
    row.className = `message-row ${senderType}`;

    let senderTagHtml = '';
    if (senderType === 'client') {
      senderTagHtml = '👤 Cliente';
    } else if (senderType === 'bot') {
      senderTagHtml = '🤖 Justi (IA)';
    } else {
      senderTagHtml = '👨‍⚖️ Estudio S&S (Respuesta Manual / Celular)';
    }

    const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';

    let contentHtml = '';
    if (m.text && m.text.includes('[Archivo Adjunto:')) {
      const parts = m.text.split('[Archivo Adjunto:');
      const mediaPath = parts[1].replace(']', '').trim();
      contentHtml = `${parts[0]}<br><a href="${mediaPath}" target="_blank" style="color:var(--accent-gold); font-weight:600; text-decoration:underline;">📎 Ver Archivo Adjunto Recibido</a>`;
    } else {
      contentHtml = escapeHTML(m.text || '');
    }

    row.innerHTML = `
      <div class="message-sender-tag">${senderTagHtml}</div>
      <div class="message-bubble-card">
        ${contentHtml}
        <span class="message-time">${timeStr}</span>
      </div>
    `;

    container.appendChild(row);
  });

  container.scrollTop = container.scrollHeight;
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

async function toggleBotPause(phone, paused) {
  await authFetch(`/api/chats/${phone}/toggle-pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paused })
  });
  await fetchChats();
  selectChat(phone);
}

// Simulator Logic
async function sendSimulatedMessage() {
  const input = document.getElementById('input-sim-msg');
  const text = input.value.trim();
  if (!text) return;

  state.simMessages.push({ sender: 'client', text, timestamp: new Date().toISOString() });
  input.value = '';
  renderSimulator();

  try {
    const res = await authFetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });
    const data = await res.json();
    if (data.reply) {
      state.simMessages.push({ sender: 'bot', text: data.reply, timestamp: new Date().toISOString() });
      renderSimulator();
    }
  } catch (err) {
    state.simMessages.push({ sender: 'bot', text: 'Disculpá, hubo un error de conexión en la simulación.', timestamp: new Date().toISOString() });
    renderSimulator();
  }
}

function renderSimulator() {
  const container = document.getElementById('sim-timeline');
  if (!container) return;
  container.innerHTML = '';
  state.simMessages.forEach(m => {
    const row = document.createElement('div');
    let senderType = m.sender;
    row.className = `message-row ${senderType}`;

    let senderTagHtml = senderType === 'client' ? '👤 Cliente (Tú)' : '🤖 Justi (IA)';
    const timeStr = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

    row.innerHTML = `
      <div class="message-sender-tag">${senderTagHtml}</div>
      <div class="message-bubble-card">
        ${escapeHTML(m.text || '')}
        <span class="message-time">${timeStr}</span>
      </div>
    `;

    container.appendChild(row);
  });
  container.scrollTop = container.scrollHeight;
}

function handleQRData(qrData) {
  const qrImg = document.getElementById('qr-image');
  const qrPlace = document.getElementById('qr-placeholder');
  if (qrData) {
    qrImg.src = qrData;
    qrImg.style.display = 'block';
    qrPlace.style.display = 'none';
  }
}

function handleWhatsAppStatus(status) {
  state.whatsappStatus = status;
  const dot = document.getElementById('wa-dot');
  const text = document.getElementById('wa-status-text');
  const sub = document.getElementById('wa-status-sub');
  const qrImg = document.getElementById('qr-image');
  const qrPlace = document.getElementById('qr-placeholder');

  dot.className = `status-indicator-dot ${status}`;

  if (status === 'connected') {
    text.innerText = 'WhatsApp Conectado';
    sub.innerText = 'Justi respondiendo automáticamente';
    qrImg.style.display = 'none';
    qrPlace.style.display = 'flex';
    qrPlace.innerHTML = '✅ <strong>WhatsApp Conectado Exitosamente</strong><p>Justi está atendiendo a tus clientes con amabilidad.</p>';
  } else if (status === 'qr_ready') {
    text.innerText = 'QR Pendiente';
    sub.innerText = 'Escaneá para iniciar sesión';
  } else {
    text.innerText = 'Desconectado';
    sub.innerText = 'Verificá tu conexión';
  }
}

// HTTP Polling Fallback for QR Image
async function pollWhatsAppQR() {
  const check = async () => {
    try {
      const res = await fetch('/api/whatsapp/qr');
      const data = await res.json();
      handleWhatsAppStatus(data.status);
      if (data.qrCode) {
        handleQRData(data.qrCode);
      }
    } catch (e) {}
  };
  check();
  setInterval(check, 2500);
}

// SSE Connection for WhatsApp QR & Status
function connectWhatsAppSSE() {
  try {
    const evtSource = new EventSource('/api/whatsapp/events');
    evtSource.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === 'status') {
        handleWhatsAppStatus(event.data);
      } else if (event.type === 'qr') {
        handleQRData(event.data);
      }
    };
  } catch (e) {
    console.error('SSE Error:', e);
  }
}
