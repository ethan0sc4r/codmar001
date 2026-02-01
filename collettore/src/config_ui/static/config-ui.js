/**
 * DarkFleet Collettore - Configuration UI
 * ========================================
 */

// State
let currentConfig = null;
let editingSourceIndex = -1;

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupEventListeners();
  loadConfiguration();
});

// ============================================================================
// Tabs
// ============================================================================

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active from all
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(tc => tc.classList.remove('active'));

      // Add active to clicked
      tab.classList.add('active');
      const tabName = tab.dataset.tab;
      document.getElementById(`${tabName}-tab`).classList.add('active');
    });
  });
}

// ============================================================================
// Event Listeners
// ============================================================================

function setupEventListeners() {
  // Save button
  document.getElementById('saveBtn').addEventListener('click', saveAndRestart);

  // Add source button
  document.getElementById('addSourceBtn').addEventListener('click', () => {
    editingSourceIndex = -1;
    openSourceModal();
  });

  // Modal controls
  document.getElementById('closeModal').addEventListener('click', closeSourceModal);
  document.getElementById('cancelSourceBtn').addEventListener('click', closeSourceModal);
  document.getElementById('saveSourceBtn').addEventListener('click', saveSource);

  // Test Redis button
  document.getElementById('testRedisBtn').addEventListener('click', testRedisConnection);

  // Stream toggles
  document.getElementById('enableRawStream').addEventListener('change', updateStreamStatus);
  document.getElementById('enableFilteredStream').addEventListener('change', updateStreamStatus);
}

// ============================================================================
// Load Configuration
// ============================================================================

async function loadConfiguration() {
  try {
    showAlert('Caricamento configurazione...', 'warning');

    const response = await fetch('/api/config');
    const data = await response.json();

    if (!data.success) {
      throw new Error('Failed to load configuration');
    }

    currentConfig = data.config;

    // Populate UI
    populateSources(currentConfig.sources || []);
    populateRedis(currentConfig.redis || {});
    populateStreams(currentConfig.output || {});

    hideAlert();

  } catch (error) {
    showAlert(`Errore caricamento: ${error.message}`, 'danger');
  }
}

// ============================================================================
// Sources
// ============================================================================

function populateSources(sources) {
  const container = document.getElementById('sourcesList');

  if (sources.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary);">Nessun server configurato. Aggiungi il primo server!</p>';
    return;
  }

  container.innerHTML = sources.map((source, index) => {
    const statusBadge = source.enabled
      ? '<span class="badge badge-success">ATTIVO</span>'
      : '<span class="badge badge-danger">DISABILITATO</span>';

    return `
      <div class="source-item ${source.enabled ? '' : 'disabled'}">
        <div class="source-info">
          <div class="source-name">
            ${source.name}
            ${statusBadge}
          </div>
          <div class="source-url">${source.url}</div>
        </div>
        <div class="source-actions">
          <button class="btn btn-secondary btn-sm" onclick="toggleSource(${index})">
            ${source.enabled ? '⏸️ Disabilita' : '▶️ Abilita'}
          </button>
          <button class="btn btn-secondary btn-sm" onclick="editSource(${index})">
            ✏️ Modifica
          </button>
          <button class="btn btn-danger btn-sm" onclick="deleteSource(${index})">
            🗑️ Elimina
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function openSourceModal(sourceData = null) {
  const modal = document.getElementById('sourceModal');
  const title = document.getElementById('modalTitle');

  if (sourceData) {
    title.textContent = 'Modifica Server Sorgente';
    document.getElementById('sourceName').value = sourceData.name || '';
    document.getElementById('sourceUrl').value = sourceData.url || '';
    document.getElementById('sourcePriority').value = sourceData.priority || 1;
    document.getElementById('sourceReconnectInterval').value = sourceData.reconnect_interval || 5000;
    document.getElementById('sourceEnabled').checked = sourceData.enabled !== false;
    document.getElementById('sourceReconnect').checked = sourceData.reconnect !== false;
  } else {
    title.textContent = 'Aggiungi Server Sorgente';
    document.getElementById('sourceName').value = '';
    document.getElementById('sourceUrl').value = '';
    document.getElementById('sourcePriority').value = 1;
    document.getElementById('sourceReconnectInterval').value = 5000;
    document.getElementById('sourceEnabled').checked = true;
    document.getElementById('sourceReconnect').checked = true;
  }

  modal.classList.add('active');
}

function closeSourceModal() {
  document.getElementById('sourceModal').classList.remove('active');
  editingSourceIndex = -1;
}

function saveSource() {
  const sourceData = {
    name: document.getElementById('sourceName').value.trim(),
    url: document.getElementById('sourceUrl').value.trim(),
    priority: parseInt(document.getElementById('sourcePriority').value),
    reconnect_interval: parseInt(document.getElementById('sourceReconnectInterval').value),
    enabled: document.getElementById('sourceEnabled').checked,
    reconnect: document.getElementById('sourceReconnect').checked,
    reconnect_max_attempts: 0, // Infinite
  };

  // Validate
  if (!sourceData.name) {
    showAlert('Nome server obbligatorio', 'danger');
    return;
  }

  if (!sourceData.url) {
    showAlert('URL WebSocket obbligatorio', 'danger');
    return;
  }

  if (!sourceData.url.startsWith('ws://') && !sourceData.url.startsWith('wss://')) {
    showAlert('URL deve iniziare con ws:// o wss://', 'danger');
    return;
  }

  // Update config
  if (!currentConfig.sources) {
    currentConfig.sources = [];
  }

  if (editingSourceIndex >= 0) {
    // Edit existing
    currentConfig.sources[editingSourceIndex] = sourceData;
  } else {
    // Add new
    currentConfig.sources.push(sourceData);
  }

  // Update UI
  populateSources(currentConfig.sources);
  closeSourceModal();
  showAlert('Server salvato. Ricorda di cliccare "Salva e Riavvia" per applicare le modifiche.', 'warning');
}

function editSource(index) {
  editingSourceIndex = index;
  const source = currentConfig.sources[index];
  openSourceModal(source);
}

function toggleSource(index) {
  currentConfig.sources[index].enabled = !currentConfig.sources[index].enabled;
  populateSources(currentConfig.sources);
  showAlert('Stato server modificato. Ricorda di cliccare "Salva e Riavvia".', 'warning');
}

function deleteSource(index) {
  const source = currentConfig.sources[index];

  if (!confirm(`Eliminare il server "${source.name}"?`)) {
    return;
  }

  currentConfig.sources.splice(index, 1);
  populateSources(currentConfig.sources);
  showAlert('Server eliminato. Ricorda di cliccare "Salva e Riavvia".', 'warning');
}

// ============================================================================
// Redis
// ============================================================================

function populateRedis(redis) {
  document.getElementById('redisHost').value = redis.host || 'localhost';
  document.getElementById('redisPort').value = redis.port || 6379;
  document.getElementById('redisDb').value = redis.db || 0;
  document.getElementById('redisPassword').value = redis.password === '********' ? '' : (redis.password || '');
}

async function testRedisConnection() {
  const btn = document.getElementById('testRedisBtn');
  const resultDiv = document.getElementById('redisTestResult');

  btn.disabled = true;
  btn.innerHTML = '🔍 Test in corso... <span class="spinner"></span>';

  try {
    const redisConfig = {
      host: document.getElementById('redisHost').value,
      port: parseInt(document.getElementById('redisPort').value),
      db: parseInt(document.getElementById('redisDb').value),
      password: document.getElementById('redisPassword').value || null,
    };

    const response = await fetch('/api/config/test-redis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(redisConfig),
    });

    const data = await response.json();

    if (data.success) {
      resultDiv.innerHTML = '<div class="alert alert-success">✅ Connessione Redis riuscita!</div>';
    } else {
      resultDiv.innerHTML = `<div class="alert alert-danger">❌ Errore: ${data.error}</div>`;
    }

  } catch (error) {
    resultDiv.innerHTML = `<div class="alert alert-danger">❌ Errore: ${error.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔍 Test Connessione';
  }
}

// ============================================================================
// Streams
// ============================================================================

function populateStreams(output) {
  const enableRaw = output.enable_raw_stream !== false;
  const enableFiltered = output.enable_filtered_stream !== false;

  document.getElementById('enableRawStream').checked = enableRaw;
  document.getElementById('enableFilteredStream').checked = enableFiltered;

  updateStreamStatus();
}

function updateStreamStatus() {
  const rawEnabled = document.getElementById('enableRawStream').checked;
  const filteredEnabled = document.getElementById('enableFilteredStream').checked;

  document.getElementById('rawStreamStatus').innerHTML = rawEnabled
    ? '<span class="status-indicator status-connected"></span> Attivo'
    : '<span class="status-indicator status-disconnected"></span> Disabilitato';

  document.getElementById('filteredStreamStatus').innerHTML = filteredEnabled
    ? '<span class="status-indicator status-connected"></span> Attivo'
    : '<span class="status-indicator status-disconnected"></span> Disabilitato';
}

// ============================================================================
// Save and Restart
// ============================================================================

async function saveAndRestart() {
  if (!confirm('Salvare la configurazione e riavviare il server?')) {
    return;
  }

  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.innerHTML = '💾 Salvataggio... <span class="spinner"></span>';

  try {
    // Gather all config
    const updateData = {
      sources: currentConfig.sources,
      redis: {
        host: document.getElementById('redisHost').value,
        port: parseInt(document.getElementById('redisPort').value),
        db: parseInt(document.getElementById('redisDb').value),
        password: document.getElementById('redisPassword').value || null,
      },
      stream_control: {
        enable_raw_stream: document.getElementById('enableRawStream').checked,
        enable_filtered_stream: document.getElementById('enableFilteredStream').checked,
      },
    };

    // Save config
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData),
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.detail || 'Failed to save configuration');
    }

    showAlert('✅ Configurazione salvata! Riavvio del server...', 'success');

    // Restart server
    setTimeout(async () => {
      try {
        await fetch('/api/config/restart', { method: 'POST' });
        showAlert('🔄 Server in fase di riavvio. Riconnessione tra 5 secondi...', 'warning');

        // Wait and reload
        setTimeout(() => {
          window.location.reload();
        }, 5000);

      } catch (error) {
        showAlert('⚠️ Riavvio richiesto. Ricarica la pagina manualmente.', 'warning');
      }
    }, 1000);

  } catch (error) {
    showAlert(`❌ Errore: ${error.message}`, 'danger');
    btn.disabled = false;
    btn.innerHTML = '💾 Salva e Riavvia';
  }
}

// ============================================================================
// Alerts
// ============================================================================

function showAlert(message, type = 'success') {
  const alertArea = document.getElementById('alertArea');
  alertArea.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

function hideAlert() {
  document.getElementById('alertArea').innerHTML = '';
}
