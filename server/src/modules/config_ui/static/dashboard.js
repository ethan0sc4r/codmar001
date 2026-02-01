// DarkFleet Dashboard - Real-time monitoring

// Configuration
const UPDATE_INTERVAL = 2000; // Update every 2 seconds
const CHART_MAX_POINTS = 0; // Keep all data points (0 = unlimited, no scrolling)
const WATCHLIST_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds

// State
let updateTimer = null;
let watchlistSyncTimer = null;
let ws = null;
let charts = {};
let lastStats = null;
let nextWatchlistSync = null;

// Chart data buffers
const chartData = {
  throughput: {
    labels: [],
    matched: []
  }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initCharts();
  startPolling();
  startWatchlistAutoSync();
});

// Initialize Chart.js charts
function initCharts() {
  // Watchlist Detection Chart
  const throughputCtx = document.getElementById('throughput-chart').getContext('2d');
  charts.throughput = new Chart(throughputCtx, {
    type: 'line',
    data: {
      labels: chartData.throughput.labels,
      datasets: [
        {
          label: 'Mercantili Rilevati',
          data: chartData.throughput.matched,
          borderColor: '#44ff44',
          backgroundColor: 'rgba(68, 255, 68, 0.1)',
          tension: 0.4,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#e0e0e0' }
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: 'Messaggi Processati',
            color: '#e0e0e0'
          },
          ticks: {
            color: '#a0a0a0',
            maxRotation: 45,
            minRotation: 45
          },
          grid: { color: 'rgba(255, 255, 255, 0.05)' }
        },
        y: {
          title: {
            display: true,
            text: 'Rilevamenti',
            color: '#e0e0e0'
          },
          ticks: {
            color: '#a0a0a0',
            stepSize: 1
          },
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          beginAtZero: true
        }
      }
    }
  });
}

// Start polling for stats
function startPolling() {
  updateStats();
  updateTimer = setInterval(updateStats, UPDATE_INTERVAL);
}

// Fetch and update statistics
async function updateStats() {
  try {
    // Use internal stats endpoint (no auth required, rate-limited)
    const response = await fetch('/internal/stats');
    if (!response.ok) throw new Error('Failed to fetch stats');

    const data = await response.json();
    updateUI(data);
    updateCharts(data);

    lastStats = data;
  } catch (error) {
    // Stats update failed - will retry on next interval
  }
}

// Update UI elements
function updateUI(data) {
  // Extract stats from new comprehensive endpoint
  const processing = data.processing || {};
  const satellite = data.satellite || {};
  const parser = data.parser || {};
  const websocket = data.websocket || {};
  const watchlist = data.watchlist || {};
  const database = data.database || {};

  // Get main metrics
  const processed = processing.messages_processed || 0;
  const matched = processing.messages_matched || 0;  // Total match events
  const uniqueVessels = processing.unique_vessels_matched || 0;  // Unique vessels
  const broadcast = websocket.messages_sent || 0;  // Get broadcast count from WebSocket stats

  // Update key metrics
  document.getElementById('stat-messages-processed').textContent = formatNumber(processed);
  document.getElementById('stat-matches').textContent = formatNumber(uniqueVessels);
  document.getElementById('stat-ws-clients').textContent = websocket.clients_connected || 0;
  document.getElementById('stat-broadcasts').textContent = formatNumber(broadcast);

  // Calculate rates
  if (lastStats && lastStats.processing) {
    const timeDiff = UPDATE_INTERVAL / 1000; // seconds
    const msgDiff = processed - (lastStats.processing.messages_processed || 0);
    const rate = (msgDiff / timeDiff).toFixed(1);
    document.getElementById('stat-messages-rate').textContent = rate;
  }

  // Calculate match rate (using total match events, not unique vessels)
  const matchRate = processed > 0 ? ((matched / processed) * 100).toFixed(2) : '0.00';
  document.getElementById('stat-match-rate').textContent = matchRate + '%';

  // WebSocket stats
  document.getElementById('stat-ws-total').textContent = websocket.total_connections || 0;

  // Satellite status
  const satConnected = satellite.connected || false;
  const satStatus = document.getElementById('satellite-status');
  const satStatusText = document.getElementById('satellite-status-text');
  const reconnectContainer = document.getElementById('reconnect-container');

  if (satConnected) {
    satStatus.className = 'status-badge online';
    satStatusText.textContent = 'Connected';
    // Hide reconnect button when connected
    if (reconnectContainer) reconnectContainer.style.display = 'none';
  } else {
    satStatus.className = 'status-badge offline';
    satStatusText.textContent = 'Disconnected';
    // Show reconnect button when disconnected
    if (reconnectContainer) reconnectContainer.style.display = 'block';
  }

  document.getElementById('satellite-connections').textContent = satellite.connection_count || 0;
  document.getElementById('satellite-reconnects').textContent = satellite.reconnect_count || 0;
  document.getElementById('satellite-messages').textContent = formatNumber(satellite.messages_received || 0);

  // Parser stats
  const parserParsed = parser.messages_parsed || processed;
  const parserErrors = parser.parse_errors || 0;
  const parserTotal = parserParsed + parserErrors;
  const parserSuccessRate = parserTotal > 0 ? ((parserParsed / parserTotal) * 100).toFixed(1) : '100.0';

  document.getElementById('parser-parsed').textContent = formatNumber(parserParsed);
  document.getElementById('parser-errors').textContent = formatNumber(parserErrors);
  document.getElementById('parser-success-rate').textContent = parserSuccessRate + '%';

  // Watchlist status
  const wlEnabled = watchlist.vessels_count !== undefined;
  const wlStatus = document.getElementById('watchlist-status');
  const wlStatusText = document.getElementById('watchlist-status-text');

  if (wlEnabled) {
    wlStatus.className = 'status-badge online';
    wlStatusText.textContent = 'Active';
  } else {
    wlStatus.className = 'status-badge offline';
    wlStatusText.textContent = 'Disabled';
  }

  document.getElementById('watchlist-vessels').textContent = formatNumber(watchlist.vessels_count || 0);
  document.getElementById('watchlist-lists').textContent = watchlist.lists_count || 0;

  // Format last sync time
  const lastSync = watchlist.last_sync_time;
  if (lastSync) {
    const syncDate = new Date(lastSync);
    document.getElementById('watchlist-sync').textContent = syncDate.toLocaleTimeString('it-IT');
  } else {
    document.getElementById('watchlist-sync').textContent = 'Never';
  }

  // Database stats
  document.getElementById('db-queries').textContent = formatNumber(database.queries_executed || 0);

  // Format database size
  const dbSize = database.database_size_bytes || 0;
  const dbSizeKB = (dbSize / 1024).toFixed(0);
  const dbSizeMB = (dbSize / 1024 / 1024).toFixed(2);
  document.getElementById('db-size').textContent = dbSize > 1024 * 1024 ? dbSizeMB + ' MB' : dbSizeKB + ' KB';

  document.getElementById('db-tables').textContent = database.tables_count || 0;
}

// Update charts with new data
function updateCharts(data) {
  // Extract current values from stats
  const processing = data.processing || {};

  const messagesMatched = processing.messages_matched || 0;  // Total match events
  const messagesProcessed = processing.messages_processed || 0;

  // Calculate deltas (rate of change) to show spikes for each match event
  let matchDelta = 0;

  if (lastStats && lastStats.processing) {
    const lastMatched = lastStats.processing.messages_matched || 0;
    matchDelta = messagesMatched - lastMatched;  // New match events in this interval
  }

  // Use messages processed count as X-axis label instead of time
  const messageLabel = formatNumber(messagesProcessed);

  // Add to throughput chart (show deltas to see spikes)
  chartData.throughput.labels.push(messageLabel);
  chartData.throughput.matched.push(matchDelta);  // Show spike when match detected

  // Keep only last N points (if CHART_MAX_POINTS > 0)
  if (CHART_MAX_POINTS > 0 && chartData.throughput.labels.length > CHART_MAX_POINTS) {
    chartData.throughput.labels.shift();
    chartData.throughput.matched.shift();
  }

  // Update Chart.js instance
  charts.throughput.update('none'); // 'none' disables animation for smoother updates
}

// Format numbers with thousands separator
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Start automatic watchlist sync
function startWatchlistAutoSync() {
  // Set initial next sync time
  nextWatchlistSync = Date.now() + WATCHLIST_SYNC_INTERVAL;

  // Update countdown every second
  setInterval(updateWatchlistCountdown, 1000);

  // Schedule automatic sync every 5 minutes
  watchlistSyncTimer = setInterval(async () => {
    await syncWatchlist(true);
  }, WATCHLIST_SYNC_INTERVAL);
}

// Update countdown timer for next sync
function updateWatchlistCountdown() {
  if (!nextWatchlistSync) return;

  const now = Date.now();
  const remaining = nextWatchlistSync - now;

  if (remaining <= 0) {
    document.getElementById('watchlist-next-sync').textContent = 'In corso...';
    return;
  }

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  document.getElementById('watchlist-next-sync').textContent =
    `${minutes}m ${seconds}s`;
}

// Reconnect satellite
async function reconnectSatellite() {
  const btn = document.getElementById('reconnect-btn');

  if (!btn) return;

  // Disable button
  btn.disabled = true;
  btn.textContent = '⏳ Riconnessione...';

  try {
    const response = await fetch('/api/satellite/reconnect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();

    if (result.status === 'reconnecting') {
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = '🔄 Riconnetti';
      }, 3000);
    } else {
      btn.textContent = '❌ Errore';
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = '🔄 Riconnetti';
      }, 2000);
    }
  } catch (error) {
    btn.textContent = '❌ Errore';
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = '🔄 Riconnetti';
    }, 2000);
  }
}

async function syncWatchlist(isAuto = false) {
  const btn = document.getElementById('sync-watchlist-btn');

  // Don't run if already syncing (unless auto)
  if (!isAuto && btn.disabled) return;

  try {
    // Update button state
    if (!isAuto) {
      btn.disabled = true;
      btn.classList.add('loading');
      btn.textContent = '';
    }

    const response = await fetch('/internal/watchlist/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();

    if (result.success) {
      // Reset next sync time
      nextWatchlistSync = Date.now() + WATCHLIST_SYNC_INTERVAL;

      // Show success message briefly (only for manual sync)
      if (!isAuto) {
        btn.textContent = '✓ Aggiornato';
        setTimeout(() => {
          btn.textContent = '🔄 Aggiorna Ora';
        }, 2000);
      }

      // Force stats update
      await updateStats();
    } else {
      if (!isAuto) {
        btn.textContent = '✗ Errore';
        setTimeout(() => {
          btn.textContent = '🔄 Aggiorna Ora';
        }, 2000);
      }
    }
  } catch (error) {
    if (!isAuto) {
      btn.textContent = '✗ Errore';
      setTimeout(() => {
        btn.textContent = '🔄 Aggiorna Ora';
      }, 2000);
    }
  } finally {
    if (!isAuto) {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (updateTimer) clearInterval(updateTimer);
  if (watchlistSyncTimer) clearInterval(watchlistSyncTimer);
});
