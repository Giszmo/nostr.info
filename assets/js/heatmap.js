(function() {
  // Config
  const MAX_RELAYS = 15; // Cap concurrent relay connections (conservative)
  const RENDER_THROTTLE_MS = 500; // Throttle map redraws
  const PRUNE_INTERVAL_MS = 10_000; // How often to prune old events
  const MAX_TIME_WINDOW_MS = 60 * 60 * 1000; // 1 hour maximum
  const RECONNECT_DELAY_MS = 5000; // Delay for temporary failures
  const PERMANENT_FAILURE_DELAY_MS = 60 * 60 * 1000; // 1 hour for permanent failures

  // Core reliable relays (from bitchat implementation)
  const CORE_RELAYS = [
    'wss://relay.damus.io',
    'wss://relay.primal.net',
    'wss://offchain.pub',
    'wss://nostr21.com',
    'wss://nos.lol',
    'wss://relay.nostr.band'
  ];

  // Use only the core bitchat relays, ignoring relays.yml
  const RELAYS = CORE_RELAYS;

  // DOM elements
  let minHashLengthSelect, maxHashLengthSelect;
  let relayCountEl, connectedCountEl, eventCountEl, timeCoveredEl;
  let minHashLengthSelectFS, maxHashLengthSelectFS;
  let relayCountElFS, connectedCountElFS, eventCountElFS, timeCoveredElFS;
  let fullscreenBtn, exitFullscreenBtn, fullscreenContainer;
  let isFullscreen = false;

  // Map and layers
  let map;
  let layers = {}; // hash length -> LayerGroup

  // State
  let sockets = [];
  let events = []; // { gh: string, len: number, ts: number }
  let pruneTimer = null;
  let renderTimer = null;
  let running = false;
  let totalEvents = 0;
  let reconnectTimers = new Map(); // relay URL -> timeout ID
  let lastRender = 0;
  let relayFailureTypes = new Map(); // relay URL -> failure type (permanent/temporary)
  let currentPopup = null; // Track current persistent popup

  function init() {
    // Get DOM elements
    minHashLengthSelect = document.getElementById('minHashLength');
    maxHashLengthSelect = document.getElementById('maxHashLength');
    relayCountEl = document.getElementById('relayCount');
    connectedCountEl = document.getElementById('connectedCount');
    eventCountEl = document.getElementById('eventCount');
    timeCoveredEl = document.getElementById('timeCoveredLabel');

    // Get fullscreen DOM elements
    minHashLengthSelectFS = document.getElementById('minHashLengthFS');
    maxHashLengthSelectFS = document.getElementById('maxHashLengthFS');
    relayCountElFS = document.getElementById('relayCountFS');
    connectedCountElFS = document.getElementById('connectedCountFS');
    eventCountElFS = document.getElementById('eventCountFS');
    timeCoveredElFS = document.getElementById('timeCoveredLabelFS');
    fullscreenBtn = document.getElementById('fullscreenBtn');
    exitFullscreenBtn = document.getElementById('exitFullscreenBtn');
    fullscreenContainer = document.getElementById('fullscreenContainer');

    // Initialize Leaflet map
    map = L.map('map', {
      worldCopyJump: true
    }).setView([20, 0], 2);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Add global click handler to close persistent popup
    map.on('click', closePersistentPopup);
    map.on('move', closePersistentPopup);

    // Create layer groups for all possible hash lengths (1-12)
    for (let len = 1; len <= 12; len++) {
      layers[len] = L.layerGroup().addTo(map);
    }

    // Update UI
    relayCountEl.textContent = RELAYS.length.toString();
    updateTimeCovered();

    // Add event listeners for filter controls
    minHashLengthSelect.addEventListener('change', () => {
      validateMinMax();
      scheduleRender();
    });
    maxHashLengthSelect.addEventListener('change', () => {
      validateMinMax();
      scheduleRender();
    });

    // Add fullscreen event listeners
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', toggleFullscreen);
    }
    if (exitFullscreenBtn) {
      exitFullscreenBtn.addEventListener('click', toggleFullscreen);
    }

    // Add event listeners for fullscreen filter controls
    if (minHashLengthSelectFS) {
      minHashLengthSelectFS.addEventListener('change', () => {
        syncFilterControls(minHashLengthSelectFS, minHashLengthSelect);
        validateMinMax();
        scheduleRender();
      });
    }
    if (maxHashLengthSelectFS) {
      maxHashLengthSelectFS.addEventListener('change', () => {
        syncFilterControls(maxHashLengthSelectFS, maxHashLengthSelect);
        validateMinMax();
        scheduleRender();
      });
    }

    // Auto-start after a brief delay
    setTimeout(start, 100);
  }

  function validateMinMax() {
    const minVal = parseInt(minHashLengthSelect.value, 10);
    const maxVal = parseInt(maxHashLengthSelect.value, 10);
    if (minVal > maxVal) {
      maxHashLengthSelect.value = minVal.toString();
    }
  }

  function updateTimeCovered() {
    const text = events.length === 0 ? '0 minutes' : (() => {
      const now = Date.now();
      const oldestEvent = Math.min(...events.map(e => e.ts));
      const timeCoveredMs = Math.min(now - oldestEvent, MAX_TIME_WINDOW_MS);
      const minutes = Math.floor(timeCoveredMs / (60 * 1000));
      return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    })();
    
    timeCoveredEl.textContent = text;
    if (timeCoveredElFS) timeCoveredElFS.textContent = text;
  }

  // Compute bounding box of a geohash
  // Returns [[latMin, lonMin], [latMax, lonMax]]
  function geohashBBox(hash) {
    const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
    let evenBit = true;
    let lat = [-90.0, 90.0];
    let lon = [-180.0, 180.0];
    const gh = (hash || '').toLowerCase().trim();

    for (let i = 0; i < gh.length; i++) {
      const c = gh[i];
      const cd = BASE32.indexOf(c);
      if (cd === -1) return null;

      for (let j = 4; j >= 0; j--) {
        const bit = (cd >> j) & 1;
        if (evenBit) {
          const mid = (lon[0] + lon[1]) / 2;
          if (bit === 1) lon[0] = mid; else lon[1] = mid;
        } else {
          const mid = (lat[0] + lat[1]) / 2;
          if (bit === 1) lat[0] = mid; else lat[1] = mid;
        }
        evenBit = !evenBit;
      }
    }
    return [[lat[0], lon[0]], [lat[1], lon[1]]];
  }

  function getColorForHashLength(length, minLength, maxLength) {
    if (minLength === maxLength) {
      return '#0066CC'; // Default blue if all same length
    }
    
    // Normalize length to 0-1 range
    const t = (length - minLength) / (maxLength - minLength);
    
    // Blue (longest) to Red (shortest): HSL interpolation
    // Blue: hsl(240, 100%, 50%) -> Red: hsl(0, 100%, 50%)
    const hue = Math.round(240 * t); // 0 (red) to 240 (blue)
    return `hsl(${hue}, 80%, 50%)`;
  }

  function scheduleRender() {
    if (renderTimer) {
      clearTimeout(renderTimer);
    }
    
    const now = Date.now();
    if (now - lastRender >= RENDER_THROTTLE_MS) {
      lastRender = now;
      renderLayers();
    } else {
      const delay = RENDER_THROTTLE_MS - (now - lastRender);
      renderTimer = setTimeout(() => {
        lastRender = Date.now();
        renderLayers();
      }, delay);
    }
  }

  function renderLayers() {
    // Get filter settings
    const minLength = parseInt(minHashLengthSelect.value, 10);
    const maxLength = parseInt(maxHashLengthSelect.value, 10);

    // Clear all layers first
    for (let len = 1; len <= 12; len++) {
      if (layers[len]) {
        layers[len].clearLayers();
      }
    }

    // Filter events by hash length
    const filteredEvents = events.filter(e => e.len >= minLength && e.len <= maxLength);
    
    if (filteredEvents.length === 0) {
      updateTimeCovered();
      return;
    }

    // Group events by exact geohash (no truncation)
    const geohashCounts = new Map();
    filteredEvents.forEach(ev => {
      const key = ev.gh; // Use full geohash, no truncation
      const current = geohashCounts.get(key) || { count: 0, length: ev.len };
      current.count++;
      geohashCounts.set(key, current);
    });

    // Find min/max lengths in filtered data for color coding
    const activeLengths = Array.from(new Set(filteredEvents.map(e => e.len))).sort((a, b) => a - b);
    const actualMinLength = activeLengths[0] || minLength;
    const actualMaxLength = activeLengths[activeLengths.length - 1] || maxLength;

    // Render each geohash cell with world wrapping
    geohashCounts.forEach(({ count, length }, geohash) => {
      const bounds = geohashBBox(geohash);
      if (!bounds) return;

      const color = getColorForHashLength(length, actualMinLength, actualMaxLength);
      const layer = layers[length];
      if (!layer) return;

      const opacity = Math.min(0.8, 0.3 + (count / Math.max(...Array.from(geohashCounts.values()).map(v => v.count))) * 0.5);
      
      // Render the rectangle with world wrapping (show on multiple world copies when zoomed out)
      renderGeohashWithWrapping(bounds, {
        stroke: true,
        weight: 1,
        color: color,
        opacity: 0.8,
        fill: true,
        fillOpacity: opacity,
        fillColor: color,
        interactive: true
      }, layer, geohash, length, count);
    });

    updateTimeCovered();
    updateDropdownCounts();
  }

  function updateDropdownCounts() {
    // Calculate statistics for each hash length
    const lengthStats = {};
    for (let len = 1; len <= 12; len++) {
      lengthStats[len] = { hashes: 0, events: 0 };
    }

    // Count unique geohashes and total events by length
    const geohashCounts = new Map();
    events.forEach(ev => {
      const key = ev.gh;
      const current = geohashCounts.get(key) || { count: 0, length: ev.len };
      current.count++;
      geohashCounts.set(key, current);
    });

    // Aggregate statistics
    geohashCounts.forEach(({ count, length }) => {
      if (lengthStats[length]) {
        lengthStats[length].hashes++;
        lengthStats[length].events += count;
      }
    });

    // Update dropdown options with counts
    updateSelectOptions(minHashLengthSelect, lengthStats);
    updateSelectOptions(maxHashLengthSelect, lengthStats);
    if (minHashLengthSelectFS) updateSelectOptions(minHashLengthSelectFS, lengthStats);
    if (maxHashLengthSelectFS) updateSelectOptions(maxHashLengthSelectFS, lengthStats);
  }

  function updateSelectOptions(selectElement, lengthStats) {
    const currentValue = selectElement.value;
    
    // Clear and rebuild options
    selectElement.innerHTML = '';
    
    for (let len = 1; len <= 12; len++) {
      const option = document.createElement('option');
      option.value = len.toString();
      
      const stats = lengthStats[len];
      const hashCount = stats.hashes;
      const eventCount = stats.events;
      
      if (hashCount > 0) {
        option.textContent = `${len} (${hashCount}h/${eventCount}e)`;
      } else {
        option.textContent = len.toString();
      }
      
      if (len.toString() === currentValue) {
        option.selected = true;
      }
      
      selectElement.appendChild(option);
    }
  }

  function renderGeohashWithWrapping(bounds, options, layer, geohash, length, count) {
    // Get current map bounds to determine world wrapping needs
    const mapBounds = map.getBounds();
    const mapWest = mapBounds.getWest();
    const mapEast = mapBounds.getEast();
    const worldWidth = 360;
    
    // Calculate how many world copies are visible when zoomed out
    const worldsVisible = Math.ceil((mapEast - mapWest) / worldWidth);
    
    // Determine number of copies to render
    let maxCopies;
    
    if (worldsVisible > 1) {
      // Zoomed out: render based on visible worlds
      maxCopies = Math.min(5, worldsVisible);
    } else {
      // Zoomed in: always render multiple copies near International Date Line
      // Check if the current view or the geohash is near the date line
      const geohashLon = (bounds[0][1] + bounds[1][1]) / 2;
      const nearDateLine = (
        // Map view crosses or is near date line
        (mapWest < -120 && mapEast > 120) ||
        mapWest > 120 || mapEast < -120 ||
        // Geohash is in Pacific region where date line issues occur
        geohashLon > 120 || geohashLon < -120
      );
      
      maxCopies = nearDateLine ? 3 : 1; // Render 3 copies near date line, 1 elsewhere
    }
    
    for (let worldOffset = -Math.floor(maxCopies / 2); worldOffset <= Math.floor(maxCopies / 2); worldOffset++) {
      const offsetBounds = [
        [bounds[0][0], bounds[0][1] + (worldOffset * worldWidth)],
        [bounds[1][0], bounds[1][1] + (worldOffset * worldWidth)]
      ];
      
      // Create rectangle for this world copy
      const rect = L.rectangle(offsetBounds, options).addTo(layer);
      
      // Add click handler for persistent popup
      rect.on('click', (e) => {
        console.log('Rectangle clicked:', geohash, length, count); // Debug log
        e.originalEvent?.stopPropagation(); // Prevent map click
        L.DomEvent.stopPropagation(e); // Also stop Leaflet event propagation
        showPersistentPopup(e.latlng, geohash, length, count);
      });

      // Add label if the cell is large enough on screen (render for all world copies)
      const center = bboxCenter(offsetBounds);
      if (center && map.getZoom() > 3) {
        const sw = map.latLngToLayerPoint(offsetBounds[0]);
        const ne = map.latLngToLayerPoint(offsetBounds[1]);
        const pxW = Math.abs(ne.x - sw.x);
        const pxH = Math.abs(sw.y - ne.y);
        const pxMin = Math.min(pxW, pxH);
        
        // Only show labels for cells that are at least 20px in size
        if (pxMin >= 20) {
          const fontSize = Math.max(8, Math.min(16, Math.floor(pxMin * 0.25)));
          
          L.marker(center, {
            interactive: false,
            icon: L.divIcon({
              className: 'cell-label',
              html: `<span style="
                display: inline-block;
                background: rgba(255,255,255,0.9);
                padding: 1px 3px;
                border-radius: 3px;
                font-size: ${fontSize}px;
                font-weight: bold;
                color: #333;
                border: 1px solid #666;
              ">${count}</span>`,
              iconSize: [fontSize * 2, fontSize + 4],
              iconAnchor: [fontSize, fontSize / 2 + 2]
            })
          }).addTo(layer);
        }
      }
    }
  }

  function bboxCenter(bounds) {
    if (!bounds || !Array.isArray(bounds) || bounds.length !== 2) return null;
    const lat = (bounds[0][0] + bounds[1][0]) / 2;
    const lon = (bounds[0][1] + bounds[1][1]) / 2;
    return [lat, lon];
  }

  function pruneOldEvents() {
    const cutoff = Date.now() - MAX_TIME_WINDOW_MS;
    const beforeCount = events.length;
    events = events.filter(e => e.ts >= cutoff && e.ts <= Date.now() + 3600_000);
    
    if (events.length !== beforeCount) {
      // Update total count display
      totalEvents = events.length;
      eventCountEl.textContent = totalEvents.toString();
      if (eventCountElFS) eventCountElFS.textContent = totalEvents.toString();
    }
  }

  function start() {
    if (running) return;
    running = true;

    totalEvents = 0;
    eventCountEl.textContent = '0';
    startTime = Date.now();

    // Reset previous state
    cleanupSockets();
    events = [];
    clearAllLayers();
    scheduleRender();

    // Connect to a shuffled subset of relays
    const urls = RELAYS.slice();
    shuffle(urls);
    const selected = urls.slice(0, Math.min(MAX_RELAYS, urls.length));

    // Start from 1 hour ago to get recent events
    const sinceSeconds = Math.floor((Date.now() - MAX_TIME_WINDOW_MS) / 1000);

    selected.forEach((url) => {
      connectToRelay(url, sinceSeconds);
    });

    // Start pruning old events
    pruneTimer = setInterval(() => {
      pruneOldEvents();
      scheduleRender();
      updateTimeCovered();
    }, PRUNE_INTERVAL_MS);

    updateConnectedCount();
  }

  function connectToRelay(url, sinceSeconds) {
    try {
      const ws = new WebSocket(url);
      const socketInfo = { url, ws, connected: false };

      ws.onopen = () => {
        socketInfo.connected = true;
        updateConnectedCount();
        
        // Clear any pending reconnection timer and failure type
        if (reconnectTimers.has(url)) {
          clearTimeout(reconnectTimers.get(url));
          reconnectTimers.delete(url);
        }
        relayFailureTypes.delete(url); // Reset failure type on successful connection
        
        // Subscribe to geohash ephemeral events (kind 20000)
        const sub = ["REQ", "gh", { kinds: [20000], since: sinceSeconds }];
        ws.send(JSON.stringify(sub));
      };

      ws.onmessage = (msg) => {
        let arr;
        try {
          arr = JSON.parse(msg.data);
        } catch {
          return;
        }
        if (!Array.isArray(arr) || arr.length < 2) return;

        if (arr[0] === "EVENT") {
          const ev = arr[2];
          if (!ev || ev.kind !== 20000) return;

          const gh = extractGeohash(ev.tags);
          if (!gh) return;

          const tsMs = (typeof ev.created_at === 'number' ? ev.created_at : 0) * 1000;
          if (tsMs > Date.now() + 3600_000) return; // Reject future events

          const norm = gh.toLowerCase().trim();
          const len = norm.length;
          const author = ev.pubkey || 'unknown';

          events.push({ gh: norm, len, ts: tsMs, author });
          totalEvents++;
          eventCountEl.textContent = totalEvents.toString();
          if (eventCountElFS) eventCountElFS.textContent = totalEvents.toString();

          scheduleRender();
        }
      };

      ws.onerror = (error) => {
        socketInfo.connected = false;
        updateConnectedCount();
        scheduleReconnect(url, sinceSeconds, error);
      };

      ws.onclose = (event) => {
        socketInfo.connected = false;
        updateConnectedCount();
        // Pass close event info which might contain error details
        scheduleReconnect(url, sinceSeconds, event);
      };

      sockets.push(socketInfo);
    } catch (error) {
      console.warn(`Failed to connect to ${url}:`, error);
      scheduleReconnect(url, sinceSeconds);
    }
  }

  function scheduleReconnect(url, sinceSeconds, error) {
    if (!running) return; // Don't reconnect if we're not running
    
    if (reconnectTimers.has(url)) {
      clearTimeout(reconnectTimers.get(url));
    }
    
    // Categorize the failure type
    const failureType = categorizeFailure(url, error);
    relayFailureTypes.set(url, failureType);
    
    // Determine appropriate retry delay
    const delay = failureType === 'permanent' ? PERMANENT_FAILURE_DELAY_MS : RECONNECT_DELAY_MS;
    
    const timerId = setTimeout(() => {
      reconnectTimers.delete(url);
      if (running) {
        // Log reconnection attempts with failure type information
        if (Math.random() < 0.1) { // Log ~10% of reconnection attempts
          const delayStr = failureType === 'permanent' ? '1h' : '5s';
          console.log(`Reconnecting to ${url} (${failureType} failure, ${delayStr} delay)...`);
        }
        // Remove old socket info for this URL
        sockets = sockets.filter(s => s.url !== url);
        connectToRelay(url, sinceSeconds);
      }
    }, delay);
    
    reconnectTimers.set(url, timerId);
  }

  function stop() {
    if (!running) return;
    running = false;

    if (pruneTimer) {
      clearInterval(pruneTimer);
      pruneTimer = null;
    }
    
    // Clear all reconnection timers
    reconnectTimers.forEach(timerId => clearTimeout(timerId));
    reconnectTimers.clear();
    
    cleanupSockets();
    updateConnectedCount();
  }

  function cleanupSockets() {
    sockets.forEach(({ ws }) => {
      try { 
        ws.close(); 
      } catch {}
    });
    sockets = [];
  }

  function updateConnectedCount() {
    const connected = sockets.reduce((acc, s) => acc + (s.connected ? 1 : 0), 0);
    connectedCountEl.textContent = connected.toString();
    if (connectedCountElFS) connectedCountElFS.textContent = connected.toString();
  }

  function clearAllLayers() {
    for (let len = 1; len <= 12; len++) {
      if (layers[len]) {
        layers[len].clearLayers();
      }
    }
  }

  // Fullscreen functions
  function toggleFullscreen() {
    isFullscreen = !isFullscreen;
    
    if (isFullscreen) {
      // Enter fullscreen
      fullscreenContainer.classList.add('active');
      // Move map to fullscreen container
      const mapElement = document.getElementById('map');
      fullscreenContainer.appendChild(mapElement);
      // Sync filter values
      if (minHashLengthSelectFS) minHashLengthSelectFS.value = minHashLengthSelect.value;
      if (maxHashLengthSelectFS) maxHashLengthSelectFS.value = maxHashLengthSelect.value;
      // Update UI elements
      syncStats();
    } else {
      // Exit fullscreen
      fullscreenContainer.classList.remove('active');
      // Move map back to original position - find the controls div and insert after it
      const mapElement = document.getElementById('map');
      const controlsDiv = document.querySelector('.controls');
      if (controlsDiv && controlsDiv.parentNode) {
        controlsDiv.parentNode.insertBefore(mapElement, controlsDiv.nextSibling);
      }
      // Sync filter values back
      minHashLengthSelect.value = minHashLengthSelectFS ? minHashLengthSelectFS.value : minHashLengthSelect.value;
      maxHashLengthSelect.value = maxHashLengthSelectFS ? maxHashLengthSelectFS.value : maxHashLengthSelect.value;
    }
    
    // Force Leaflet to resize the map
    setTimeout(() => {
      if (map) {
        map.invalidateSize();
      }
    }, 100);
  }

  function syncFilterControls(source, target) {
    if (source && target) {
      target.value = source.value;
    }
  }

  function syncStats() {
    if (relayCountElFS) relayCountElFS.textContent = relayCountEl.textContent;
    if (connectedCountElFS) connectedCountElFS.textContent = connectedCountEl.textContent;
    if (eventCountElFS) eventCountElFS.textContent = eventCountEl.textContent;
    if (timeCoveredElFS) timeCoveredElFS.textContent = timeCoveredEl.textContent;
  }

  // Categorize WebSocket errors as permanent or temporary failures
  function categorizeFailure(url, error) {
    // Try to extract error information from the URL or error object
    const urlLower = url.toLowerCase();
    const errorStr = (error?.message || error?.toString() || '').toLowerCase();
    
    // Check for permanent failure indicators
    const permanentIndicators = [
      'err_name_not_resolved',
      'err_cert_date_invalid', 
      'err_cert_authority_invalid',
      'err_cert_common_name_invalid',
      'err_connection_refused',
      'err_ssl_unrecognized_name_alert',
      'err_cert_invalid',
      'net::err_cert_date_invalid',
      'net::err_name_not_resolved',
      'net::err_connection_refused',
      'getaddrinfo enotfound',
      'connect econnrefused'
    ];
    
    // Check error message for permanent failure indicators
    for (const indicator of permanentIndicators) {
      if (errorStr.includes(indicator)) {
        return 'permanent';
      }
    }
    
    // Additional heuristics for permanent failures based on URL patterns
    // Check if URL has suspicious patterns that suggest it's likely offline
    if (urlLower.includes('localhost') || urlLower.includes('127.0.0.1')) {
      return 'permanent'; // Local services are likely not running
    }
    
    // Default to temporary for other connection issues (timeouts, network errors, etc.)
    return 'temporary';
  }

  // Utility functions
  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  function extractGeohash(tags) {
    if (!Array.isArray(tags)) return null;
    // Find first ["g", geohash, ...] tag
    for (const t of tags) {
      if (Array.isArray(t) && t.length >= 2 && t[0] === 'g' && typeof t[1] === 'string' && t[1].length > 0) {
        return t[1];
      }
    }
    return null;
  }

  function showPersistentPopup(latlng, geohash) {
    // Close any existing popup
    closePersistentPopup();
    
    // Create new persistent popup showing only geohash
    currentPopup = L.popup({
      closeButton: false,
      autoClose: false,
      closeOnClick: false,
      closeOnEscapeKey: true
    })
    .setLatLng(latlng)
    .setContent(`<div style="font-family: monospace; font-size: 14px; font-weight: bold;">${geohash}</div>`)
    .openOn(map);
  }

  function closePersistentPopup() {
    if (currentPopup) {
      map.closePopup(currentPopup);
      currentPopup = null;
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 0);
  } else {
    window.addEventListener('DOMContentLoaded', init);
  }

  // Expose stop function globally for cleanup if needed
  window.stopHeatmap = stop;
})();
