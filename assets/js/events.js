---
permalink: /js/events.js
layout: none
---

(function(){
  const DEFAULT_AVATAR = "/assets/smallNoicon.png";
  const EVENTS_LIMIT = 60;
  const PRESET_TABS = [
    { id: 'all', label: 'All', icon: `{% fa_svg fas.fa-stream %}` },
    { id: '1', label: 'Notes', icon: `{% fa_svg fas.fa-comment %}` },
    { id: '6', label: 'Reposts', icon: `{% fa_svg fas.fa-retweet %}` },
    { id: '7', label: 'Reactions', icon: `{% fa_svg fas.fa-heart %}` },
    { id: '2', label: 'Relay Recs', icon: `{% fa_svg fas.fa-tower-broadcast %}` },
    { id: '4', label: 'Direct Msgs', icon: `{% fa_svg fas.fa-envelope %}` },
    { id: '9735', label: 'Zaps', icon: `{% fa_svg fas.fa-bolt %}` }
  ];
  const LOADING_SKELETON_COUNT = 4;

  let activeKind = 'all';
  let searchQuery = '';
  let lastTabsSignature = '';

  document.addEventListener('DOMContentLoaded', init);
  document.addEventListener('nostrStats:eventsUpdated', () => requestAnimationFrame(renderActiveTab));

  if (window.nostrStats && typeof window.nostrStats.subscribeEvents === 'function') {
    window.nostrStats.subscribeEvents(() => requestAnimationFrame(renderActiveTab));
  }

  window.applyEventsSearch = function(query){
    searchQuery = (query || '').trim().toLowerCase();
    renderActiveTab();
  };

  function init() {
    const tabsHost = document.getElementById('events-tabs');
    const panelHost = document.getElementById('events-panel');
    if (!tabsHost || !panelHost) return;
    ensureTabs();
    renderActiveTab();
  }

  function ensureTabs(){
    const tabsHost = document.getElementById('events-tabs');
    if (!tabsHost) return;

    const availableTabs = buildTabList();
    const signature = availableTabs.map(tab => tab.id).join('|');

    if (!availableTabs.some(tab => tab.id === activeKind)) {
      activeKind = 'all';
    }

    const needsRebuild = signature !== lastTabsSignature || tabsHost.childElementCount !== availableTabs.length;

    if (needsRebuild) {
      lastTabsSignature = signature;
      tabsHost.innerHTML = availableTabs.map(tab => tabTemplate(tab)).join('');
      tabsHost.querySelectorAll('button[data-kind]').forEach(btn => {
        btn.addEventListener('click', handleTabClick);
      });
    }

    tabsHost.querySelectorAll('button[data-kind]').forEach(btn => {
      const kind = btn.getAttribute('data-kind');
      const isActive = kind === activeKind;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  function buildTabList(){
    const seen = new Set();
    const list = [];

    PRESET_TABS.forEach(tab => {
      if (seen.has(tab.id)) return;
      seen.add(tab.id);
      list.push(tab);
    });

    if (window.nostrStats && typeof window.nostrStats.getAvailableEventKinds === 'function') {
      const dynamicKinds = window.nostrStats.getAvailableEventKinds();
      dynamicKinds.forEach(kindId => {
        const kindKey = String(kindId);
        if (seen.has(kindKey)) return;
        seen.add(kindKey);
        const label = window.nostrStats.getKindLabel ? window.nostrStats.getKindLabel(kindId) : `Kind ${kindId}`;
        list.push({ id: kindKey, label, icon: `{% fa_svg fas.fa-hashtag %}` });
      });
    }

    return list.sort((a, b) => {
      if (a.id === 'all') return -1;
      if (b.id === 'all') return 1;
      const countDiff = getEventsCountForKind(b.id) - getEventsCountForKind(a.id);
      if (countDiff !== 0) return countDiff;
      return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
    });
  }

  function updateTabBadges(){
    const tabsHost = document.getElementById('events-tabs');
    if (!tabsHost || !window.nostrStats) return;
    tabsHost.querySelectorAll('button[data-kind]').forEach(btn => {
      const kind = btn.getAttribute('data-kind');
      const events = window.nostrStats.getEventsForKind ? window.nostrStats.getEventsForKind(kind) : [];
      const badge = btn.querySelector('.events-tab-count');
      if (badge) {
        badge.textContent = events.length > 99 ? '99+' : events.length;
      }
    });
  }

  function renderActiveTab(){
    ensureTabs();
    updateTabBadges();
    updateProgressBanner();
    renderEventsList(activeKind);
  }

  function handleTabClick(event){
    const btn = event.currentTarget;
    if (!btn) return;
    const kind = btn.getAttribute('data-kind');
    if (!kind || kind === activeKind) return;
    activeKind = kind;
    renderActiveTab();
  }

  function renderEventsList(kind){
    const panelHost = document.getElementById('events-panel');
    if (!panelHost) return;
    const tabId = `events-tab-${kind || 'all'}`;
    if (panelHost.getAttribute('aria-labelledby') !== tabId) {
      panelHost.setAttribute('aria-labelledby', tabId);
    }

    if (!window.nostrStats || typeof window.nostrStats.getEventsForKind !== 'function') {
      panelHost.innerHTML = buildLoadingState(kind, { fallback: 'Connecting to relays…' });
      return;
    }

    const rawEvents = window.nostrStats.getEventsForKind(kind || 'all');
    const events = rawEvents
      .filter(Boolean)
      .sort((a, b) => getEventTimestampMs(b) - getEventTimestampMs(a))
      .filter(ev => searchQuery === '' || matchesSearch(ev, searchQuery))
      .slice(0, EVENTS_LIMIT);

    if (!events.length) {
      panelHost.innerHTML = buildLoadingState(kind, { searchActive: searchQuery !== '' });
      return;
    }

    const markup = events.map(event => buildEventCard(event)).join('');
    panelHost.innerHTML = `<div class="events-feed">${markup}</div>`;
  }

  function matchesSearch(event, query){
    if (!event) return false;
    if (event.content && event.content.toLowerCase().includes(query)) return true;
    if (event.id && event.id.toLowerCase().includes(query)) return true;
    if (event.pubkey && event.pubkey.toLowerCase().includes(query)) return true;
    const metadata = window.nostrStats.getMetadataForPubkey ? window.nostrStats.getMetadataForPubkey(event.pubkey) : null;
    if (metadata) {
      const corpus = [metadata.name, metadata.displayName, metadata.about, metadata.nip05].filter(Boolean).join(' ').toLowerCase();
      if (corpus.includes(query)) return true;
    }
    return false;
  }

  function buildEventCard(event){
    const metadata = window.nostrStats.getMetadataForPubkey ? window.nostrStats.getMetadataForPubkey(event.pubkey) : null;
    const authorName = metadata?.displayName || metadata?.name || shorten(event.pubkey);
    const avatar = metadata?.picture || DEFAULT_AVATAR;
    const relay = event.relayUrl || 'unknown relay';
    const timestampText = formatRelativeTime(getEventTimestampMs(event) || Date.now());
    const tagMarkup = renderEventTags(event);

    return `
      <article class="event-card" data-kind="${event.kind}">
        <header class="event-card-header">
          <img class="event-avatar" src="${escapeAttr(avatar)}" alt="${escapeAttr(authorName)} avatar" onerror="this.src='${DEFAULT_AVATAR}'">
          <div class="event-card-meta">
            <div class="event-author">${escapeHtml(authorName)}</div>
            <div class="event-submeta">${escapeHtml(timestampText)}</div>
          </div>
        </header>
        <div class="event-body">${renderEventBody(event)}</div>
        ${tagMarkup}
        <footer class="event-footer">
          <span class="event-relay">${escapeHtml(relay)}</span>
        </footer>
      </article>
    `;
  }

  function renderEventBody(event){
    if (!event || !event.content) {
      return '<p class="event-empty">No content</p>';
    }
    if (event.kind === 1 || event.kind === 30023 || event.kind === 9802) {
      return wrapParagraphs(event.content);
    }
    // attempt to pretty print JSON
    if (looksLikeJson(event.content)) {
      try {
        const parsed = JSON.parse(event.content);
        const preview = escapeHtml(JSON.stringify(parsed, null, 2));
        return `<pre class="event-json">${preview}</pre>`;
      } catch (err) {
        // fall back to plain text
      }
    }
    return wrapParagraphs(event.content);
  }

  function wrapParagraphs(text){
    if (typeof text !== 'string') {
      return '<p class="event-empty">No content</p>';
    }
    let trimmed = text.trim();
    if (trimmed.length > 700) {
      trimmed = trimmed.slice(0, 700) + '…';
    }
    const safe = escapeHtml(trimmed).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
    return `<p>${safe}</p>`;
  }

  function looksLikeJson(str){
    return typeof str === 'string' && str.trim().startsWith('{') && str.trim().endsWith('}');
  }

  function emptyState(message){
    return `<div class="events-empty">${escapeHtml(message)}</div>`;
  }

  function buildLoadingState(kind, options = {}) {
    const { searchActive = false, fallback = '' } = options;
    const snapshot = getConnectionSnapshot();
    const allEventsCount = window.nostrStats && typeof window.nostrStats.getEventsForKind === 'function'
      ? window.nostrStats.getEventsForKind('all').length
      : 0;
    const kindLabel = buildKindLabel(kind);

    let primaryMessage = fallback || 'Waiting for events…';
    if (!fallback) {
      if (searchActive) {
        primaryMessage = 'No events match this search yet.';
      } else if (snapshot && snapshot.connected === 0 && snapshot.total > 0) {
        primaryMessage = 'Connecting to relays…';
      } else if (allEventsCount === 0) {
        primaryMessage = 'Listening for the first events from connected relays…';
      } else {
        primaryMessage = `No recent activity for ${kindLabel} yet.`;
      }
    }

  const detailLines = [];
    if (snapshot && snapshot.total) {
      const successRate = snapshot.successRate ? Math.round(snapshot.successRate) : 0;
      detailLines.push(`${snapshot.connected}/${snapshot.total} relays online (${successRate}% success)`);
      if (snapshot.curated.total || snapshot.discovered.total) {
        detailLines.push(`${snapshot.curated.connected}/${snapshot.curated.total} curated · ${snapshot.discovered.connected}/${snapshot.discovered.total} discovered`);
      }
    }
    if (searchActive) {
      detailLines.push('Try adjusting the search query or clearing the filter.');
    } else if (allEventsCount > 0) {
      detailLines.push('Other kinds are streaming in; this feed updates instantly when matching events arrive.');
    } else {
      detailLines.push('Relays respond at different speeds—new events appear the moment they publish.');
    }

    const skeletonMarkup = createSkeletonCards(LOADING_SKELETON_COUNT);

    return `
      <div class="events-loading" role="status" aria-live="polite">
        <div class="events-loading-spinner" aria-hidden="true"></div>
        <div class="events-loading-message">${escapeHtml(primaryMessage)}</div>
        <div class="events-loading-sub">${escapeHtml(kindLabel)}</div>
        <div class="events-loading-stats">
          ${detailLines.map(line => `<span>${escapeHtml(line)}</span>`).join('')}
        </div>
        <div class="events-feed events-feed--loading">
          ${skeletonMarkup}
        </div>
      </div>
    `;
  }

  function createSkeletonCards(count){
    return Array.from({ length: count }, () => `
      <article class="event-card skeleton" aria-hidden="true">
        <header class="event-card-header">
          <div class="event-avatar skeleton-block"></div>
          <div class="event-card-meta">
            <div class="skeleton-line skeleton-line--wide"></div>
            <div class="skeleton-line skeleton-line--narrow"></div>
          </div>
        </header>
        <div class="event-body">
          <div class="skeleton-line skeleton-line--wide"></div>
          <div class="skeleton-line skeleton-line--medium"></div>
          <div class="skeleton-line skeleton-line--short"></div>
        </div>
        <footer class="event-footer">
          <div class="skeleton-pill skeleton-pill--wide"></div>
          <div class="skeleton-pill skeleton-pill--narrow"></div>
        </footer>
      </article>
    `).join('');
  }

  function tabTemplate(tab){
    const isActive = tab.id === activeKind;
    return `
      <button type="button" role="tab" class="events-tab ${isActive ? 'active' : ''}" id="events-tab-${tab.id}" aria-selected="${isActive}" aria-controls="events-panel" data-kind="${tab.id}">
        <span class="events-tab-icon">${tab.icon}</span>
        <span class="events-tab-label">${escapeHtml(tab.label)}</span>
        <span class="events-tab-count">0</span>
      </button>
    `;
  }

  function escapeHtml(str){
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(str){
    return escapeHtml(str).replace(/`/g, '&#96;');
  }

  function shorten(value, lead = 8, trail = 6){
    if (!value || value.length <= lead + trail + 1) return value || '';
    return `${value.slice(0, lead)}…${value.slice(-trail)}`;
  }

  function formatRelativeTime(timestamp){
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffSec = Math.round(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.round(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    const date = new Date(timestamp);
    return date.toLocaleDateString();
  }

  function getConnectionSnapshot(){
    if (window.nostrStats && typeof window.nostrStats.getConnectionSnapshot === 'function') {
      return window.nostrStats.getConnectionSnapshot();
    }
    return null;
  }

  function getEventTimestampMs(event){
    if (!event) return 0;
    if (typeof event.created_at === 'number') return event.created_at * 1000;
    if (typeof event.receivedAt === 'number') return event.receivedAt;
    return 0;
  }

  function getEventsCountForKind(kind){
    if (!window.nostrStats || typeof window.nostrStats.getEventsForKind !== 'function') {
      return 0;
    }
    const bucket = window.nostrStats.getEventsForKind(kind);
    return Array.isArray(bucket) ? bucket.length : 0;
  }

  function buildKindLabel(kind){
    if (kind === 'all') return 'All events';
    if (window.nostrStats && typeof window.nostrStats.getKindLabel === 'function') {
      return window.nostrStats.getKindLabel(kind);
    }
    return `Kind ${kind}`;
  }

  function updateProgressBanner(){
    const banner = document.getElementById('events-progress-banner');
    if (!banner) return;
    const indicator = banner.querySelector('.events-progress-indicator');
    const textEl = banner.querySelector('.events-progress-text');
    if (!indicator || !textEl) return;

    const snapshot = getConnectionSnapshot();
    if (!snapshot || !snapshot.total) {
      textEl.textContent = 'Connecting to relays…';
      indicator.classList.remove('is-ready');
      return;
    }

    const success = snapshot.successRate ? Math.round(snapshot.successRate) : 0;
    const curatedPart = snapshot.curated && snapshot.curated.total
      ? ` · ${snapshot.curated.connected}/${snapshot.curated.total} curated`
      : '';
    const discoveredPart = snapshot.discovered && snapshot.discovered.total
      ? ` · ${snapshot.discovered.connected}/${snapshot.discovered.total} discovered`
      : '';

    textEl.textContent = `${snapshot.connected}/${snapshot.total} relays online (${success}% success)${curatedPart}${discoveredPart}`;

    if (snapshot.connected > 0) {
      indicator.classList.add('is-ready');
    } else {
      indicator.classList.remove('is-ready');
    }
  }

  function renderEventTags(event){
    if (!event || !Array.isArray(event.tags) || !event.tags.length) {
      return '';
    }

    const hashtags = [];
    const mentions = [];
    const references = [];

    event.tags.forEach((tag, index) => {
      if (!Array.isArray(tag) || tag.length < 2) return;
      const [type, value] = tag;
      if (!value) return;
      switch (type) {
        case 't': {
          hashtags.push(value.trim());
          break;
        }
        case 'p': {
          const petname = tag[3] ? String(tag[3]).trim() : '';
          mentions.push({ value: value.trim(), petname, index });
          break;
        }
        case 'e': {
          const marker = tag[3] ? String(tag[3]).trim() : '';
          references.push({ value: value.trim(), marker, index });
          break;
        }
        default:
          break;
      }
    });

    if (!hashtags.length && !mentions.length && !references.length) {
      return '';
    }

    const sections = [];
    if (hashtags.length) {
      const chips = hashtags.slice(0, 12).map(tag =>
        `<span class="event-chip event-chip--hashtag">#${escapeHtml(tag)}</span>`
      ).join('');
      sections.push(`<div class="event-chip-row" aria-label="Hashtags">${chips}</div>`);
    }
    if (mentions.length) {
      const chips = mentions.slice(0, 12).map(item => {
        const display = item.petname ? `${item.petname} (${shorten(item.value)})` : shorten(item.value);
        const title = `Mention ${item.petname || item.value}`;
        return `<span class="event-chip event-chip--mention" title="${escapeAttr(title)}">@${escapeHtml(display)}</span>`;
      }).join('');
      sections.push(`<div class="event-chip-row" aria-label="Mentions">${chips}</div>`);
    }
    if (references.length) {
      const chips = references.slice(0, 12).map(item => {
        const label = item.marker ? `${item.marker}` : 'event';
        const title = `Event reference ${item.value}`;
        return `<span class="event-chip event-chip--reference" title="${escapeAttr(title)}">↗ ${escapeHtml(label)} ${escapeHtml(shorten(item.value))}</span>`;
      }).join('');
      sections.push(`<div class="event-chip-row" aria-label="References">${chips}</div>`);
    }

    if (!sections.length) return '';

    return `<div class="event-meta">${sections.join('')}</div>`;
  }
})();
