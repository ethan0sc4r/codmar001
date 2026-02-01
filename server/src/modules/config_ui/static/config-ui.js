/**
 * DarkFleet Server Configuration UI - JavaScript
 * ===============================================
 * Client-side logic for configuration interface
 */

// API base URL (adjust if needed)
const API_BASE = '';

// Current configuration
let currentConfig = null;

/**
 * Initialize on page load
 */
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
});

/**
 * Load configuration from server
 */
async function loadConfig() {
  try {
    showStatus('loading', 'Caricamento configurazione...');

    const response = await fetch(`${API_BASE}/api/config`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    currentConfig = await response.json();
    populateForm(currentConfig);

    showStatus('success', 'Configurazione caricata');
    showAlert('success', '✓ Configurazione caricata con successo');
  } catch (error) {
    showStatus('error', 'Errore caricamento');
    showAlert('danger', `Errore nel caricamento della configurazione: ${error.message}`);
  }
}

/**
 * Populate form with configuration data
 */
function populateForm(config) {
  // Satellite
  setValue('satellite-host', config.satellite?.host);
  setValue('satellite-port', config.satellite?.port);

  // Handle both nested and flat config formats
  const satReconnect = config.satellite?.reconnect;
  if (typeof satReconnect === 'boolean') {
    // Flat format (Python)
    setChecked('satellite-reconnect-enabled', satReconnect);
    setValue('satellite-reconnect-interval', config.satellite?.reconnect_interval);
    setValue('satellite-reconnect-attempts', config.satellite?.reconnect_max_attempts);
  } else {
    // Nested format (Node.js)
    setChecked('satellite-reconnect-enabled', satReconnect?.enabled);
    setValue('satellite-reconnect-interval', satReconnect?.interval_ms);
    setValue('satellite-reconnect-attempts', satReconnect?.max_attempts);
  }

  // Watchlist API
  setValue('watchlist-base-url', config.watchlist?.api?.base_url);

  // Handle both endpoint formats
  const vessels = config.watchlist?.api?.endpoints?.vessels || config.watchlist?.api?.vessels_endpoint;
  const lists = config.watchlist?.api?.endpoints?.lists || config.watchlist?.api?.lists_endpoint;
  setValue('watchlist-vessels-endpoint', vessels);
  setValue('watchlist-lists-endpoint', lists);

  setValue('watchlist-auth-type', config.watchlist?.api?.auth?.type);
  // Don't populate token (security - show placeholder)

  // Handle both timeout formats
  const timeout = config.watchlist?.api?.timeout_ms || config.watchlist?.api?.timeout;
  setValue('watchlist-timeout', timeout);

  const retries = config.watchlist?.api?.retry?.max_retries || config.watchlist?.api?.retry_attempts;
  setValue('watchlist-max-retries', retries);

  // WebSocket
  setValue('websocket-host', config.websocket?.host);
  setValue('websocket-port', config.websocket?.port);
  setChecked('websocket-ssl-enabled', config.websocket?.ssl?.enabled);

  // Handle both cert/key formats
  const cert = config.websocket?.ssl?.cert_path || config.websocket?.ssl?.cert;
  const key = config.websocket?.ssl?.key_path || config.websocket?.ssl?.key;
  setValue('websocket-ssl-cert', cert);
  setValue('websocket-ssl-key', key);

  setValue('websocket-max-clients', config.websocket?.max_clients);
  setValue('websocket-compression', config.websocket?.compression?.toString());

  // Handle both heartbeat formats
  const hbInterval = config.websocket?.heartbeat?.interval_ms || config.websocket?.heartbeat_interval;
  const hbTimeout = config.websocket?.heartbeat?.timeout_ms || config.websocket?.heartbeat_timeout;
  setChecked('websocket-heartbeat-enabled', hbInterval ? true : false);
  setValue('websocket-heartbeat-interval', hbInterval);
  setValue('websocket-heartbeat-timeout', hbTimeout);

  // WebSocket streams
  setChecked('websocket-enable-all-stream', config.websocket?.enable_all_stream ?? true);
  setChecked('websocket-enable-watchlist-stream', config.websocket?.enable_watchlist_stream ?? true);

  // Database
  setValue('database-path', config.database?.path);

  // Handle both pragma formats
  const journalMode = config.database?.pragmas?.journal_mode || config.database?.journal_mode;
  const synchronous = config.database?.pragmas?.synchronous || config.database?.synchronous;
  const cacheSize = config.database?.pragmas?.cache_size || config.database?.cache_size;
  const mmapSize = config.database?.pragmas?.mmap_size || config.database?.mmap_size;

  setValue('database-journal-mode', journalMode);
  setValue('database-synchronous', synchronous);
  setValue('database-cache-size', cacheSize);
  setValue('database-mmap-size', mmapSize);

  // Logging
  setValue('logging-level', config.logging?.level?.toLowerCase());
  setValue('logging-format', config.logging?.format);
  setChecked('logging-pretty-enabled', config.logging?.pretty?.enabled);

  // Monitoring
  setChecked('monitoring-enabled', config.monitoring?.enabled);

  // Handle both health_check formats
  const healthCheck = config.monitoring?.health_check?.enabled ?? config.monitoring?.health_check;
  setChecked('monitoring-health-enabled', healthCheck);
}

/**
 * Save configuration to server
 */
async function saveConfig() {
  try {
    showStatus('loading', 'Salvataggio...');

    // Build config object from form
    const config = {
      satellite: {
        host: getValue('satellite-host'),
        port: parseInt(getValue('satellite-port')),
        protocol: 'tcp',
        reconnect: {
          enabled: getChecked('satellite-reconnect-enabled'),
          interval_ms: parseInt(getValue('satellite-reconnect-interval')),
          max_attempts: parseInt(getValue('satellite-reconnect-attempts')),
        },
      },
      watchlist: {
        api: {
          base_url: getValue('watchlist-base-url'),
          auth: {
            type: getValue('watchlist-auth-type'),
            token: getValue('watchlist-auth-token') || '${WATCHLIST_API_TOKEN}',
          },
          endpoints: {
            vessels: getValue('watchlist-vessels-endpoint'),
            lists: getValue('watchlist-lists-endpoint'),
          },
          timeout_ms: parseInt(getValue('watchlist-timeout')),
          retry: {
            enabled: true,
            max_retries: parseInt(getValue('watchlist-max-retries')),
            delay_ms: 1000,
          },
        },
      },
      websocket: {
        host: getValue('websocket-host'),
        port: parseInt(getValue('websocket-port')),
        ssl: {
          enabled: getChecked('websocket-ssl-enabled'),
          cert_path: getValue('websocket-ssl-cert'),
          key_path: getValue('websocket-ssl-key'),
        },
        max_clients: parseInt(getValue('websocket-max-clients')),
        compression: getValue('websocket-compression') === 'true',
        heartbeat: {
          enabled: getChecked('websocket-heartbeat-enabled'),
          interval_ms: parseInt(getValue('websocket-heartbeat-interval')),
          timeout_ms: parseInt(getValue('websocket-heartbeat-timeout')),
        },
        enable_all_stream: getChecked('websocket-enable-all-stream'),
        enable_watchlist_stream: getChecked('websocket-enable-watchlist-stream'),
      },
      database: {
        path: getValue('database-path'),
        pragmas: {
          journal_mode: getValue('database-journal-mode'),
          synchronous: getValue('database-synchronous'),
          cache_size: parseInt(getValue('database-cache-size')),
          temp_store: 'MEMORY',
          mmap_size: parseInt(getValue('database-mmap-size')),
        },
      },
      logging: {
        level: getValue('logging-level'),
        format: getValue('logging-format'),
        destination: 'stdout',
        pretty: {
          enabled: getChecked('logging-pretty-enabled'),
          colorize: true,
          translateTime: 'SYS:standard',
        },
      },
      monitoring: {
        enabled: getChecked('monitoring-enabled'),
        metrics: {
          endpoint: '/metrics',
          enabled: false,
        },
        health_check: {
          endpoint: '/health',
          enabled: getChecked('monitoring-health-enabled'),
        },
      },
    };

    const response = await fetch(`${API_BASE}/api/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.errors ? result.errors.join(', ') : 'Errore sconosciuto');
    }

    showStatus('success', 'Configurazione salvata');
    showAlert('success', '✓ Configurazione salvata con successo! Riavvia il server per applicare le modifiche.');

  } catch (error) {
    showStatus('error', 'Errore salvataggio');
    showAlert('danger', `Errore nel salvataggio: ${error.message}`);
  }
}

/**
 * Test satellite connection
 */
async function testSatellite() {
  const resultDiv = document.getElementById('satellite-test-result');
  resultDiv.textContent = '🧪 Test in corso...';
  resultDiv.className = 'test-result';
  resultDiv.style.display = 'block';

  try {
    const response = await fetch(`${API_BASE}/api/config/test-satellite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: getValue('satellite-host'),
        port: parseInt(getValue('satellite-port')),
      }),
    });

    const result = await response.json();

    resultDiv.className = result.success ? 'test-result success' : 'test-result error';
    resultDiv.textContent = result.message;

  } catch (error) {
    resultDiv.className = 'test-result error';
    resultDiv.textContent = `Errore test: ${error.message}`;
  }
}

/**
 * Test watchlist API
 */
async function testWatchlist() {
  const resultDiv = document.getElementById('watchlist-test-result');
  resultDiv.textContent = '🧪 Test in corso...';
  resultDiv.className = 'test-result';
  resultDiv.style.display = 'block';

  try {
    const response = await fetch(`${API_BASE}/api/config/test-watchlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base_url: getValue('watchlist-base-url'),
        vessels_endpoint: getValue('watchlist-vessels-endpoint'),
        lists_endpoint: getValue('watchlist-lists-endpoint'),
        auth_type: getValue('watchlist-auth-type'),
        auth_token: getValue('watchlist-auth-token'),
      }),
    });

    const result = await response.json();

    resultDiv.className = result.success ? 'test-result success' : 'test-result error';

    if (result.success && result.details) {
      resultDiv.textContent = `✓ ${result.message}\n` +
        `Vessels: ${result.details.vessels.count} items (status ${result.details.vessels.status})\n` +
        `Lists: ${result.details.lists.count} items (status ${result.details.lists.status})`;
    } else {
      resultDiv.textContent = result.message;
    }

  } catch (error) {
    resultDiv.className = 'test-result error';
    resultDiv.textContent = `Errore test: ${error.message}`;
  }
}

/**
 * Test WebSocket port
 */
async function testWebSocket() {
  const resultDiv = document.getElementById('websocket-test-result');
  resultDiv.textContent = '🧪 Test in corso...';
  resultDiv.className = 'test-result';
  resultDiv.style.display = 'block';

  try {
    const response = await fetch(`${API_BASE}/api/config/test-websocket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        port: parseInt(getValue('websocket-port')),
      }),
    });

    const result = await response.json();

    resultDiv.className = result.success ? 'test-result success' : 'test-result error';
    resultDiv.textContent = result.message;

  } catch (error) {
    resultDiv.className = 'test-result error';
    resultDiv.textContent = `Errore test: ${error.message}`;
  }
}

/**
 * Switch tab
 */
function switchTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');

  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.getElementById(`tab-${tabName}`).classList.add('active');
}

/**
 * Show status indicator
 */
function showStatus(type, text) {
  const indicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');

  indicator.className = 'status-indicator';
  if (type === 'success') {
    indicator.classList.add('success');
  } else if (type === 'error') {
    indicator.classList.add('danger');
  } else if (type === 'loading') {
    indicator.classList.add('warning');
  }

  statusText.textContent = text;
}

/**
 * Show alert message
 */
function showAlert(type, message) {
  const alert = document.getElementById('alert');
  alert.className = `alert alert-${type}`;
  alert.textContent = message;

  // Auto-hide after 5 seconds
  setTimeout(() => {
    alert.classList.add('hidden');
  }, 5000);
}

/**
 * Helper: Get input value
 */
function getValue(id) {
  const elem = document.getElementById(id);
  return elem ? elem.value : '';
}

/**
 * Helper: Set input value
 */
function setValue(id, value) {
  const elem = document.getElementById(id);
  if (elem && value !== undefined && value !== null) {
    elem.value = value;
  }
}

/**
 * Helper: Get checkbox state
 */
function getChecked(id) {
  const elem = document.getElementById(id);
  return elem ? elem.checked : false;
}

/**
 * Helper: Set checkbox state
 */
function setChecked(id, checked) {
  const elem = document.getElementById(id);
  if (elem) {
    elem.checked = !!checked;
  }
}
