/**
 * AdScope AI — Frontend Application Controller (V2 Enhanced)
 * Ascendant Labs / Agentic Meta Ad Search Engine
 * 
 * Features:
 * - Real-time PDP profiling & multi-vector comparable search
 * - Instant client-side filtering & multi-metric sorting
 * - On-demand 10-per-page lightweight media sniffing with persistent caching
 * - Interactive inline video players with audio mute/unmute
 * - Spacious 2-column modal inspection with 1-click copy & asset downloads
 * - Export full competitor dossiers as CSV spreadsheet or JSON dataset
 */

// ─── AdMedia Component reference (loaded from /media.js) ───
const AdMedia = window.AdMedia || { render: () => {}, dispose: () => {} };

// Application State
const state = {
  currentInput: '',
  currentPage: 1,
  pageSize: 10,
  totalPages: 1,
  rawRankedAds: [],       // All ads returned by server
  sourceAdsFound: 0,      // Raw Ads Library records before creative deduplication
  currentProfile: null,
  resolvedMediaMap: {},   // adId -> { thumbnailUrl, videoUrl, mediaType }
  blockedAdIds: new Set(), // inaccessible Meta previews are not shown as creatives
};

function cleanCopy(text) {
  if (!text || typeof text !== 'string') return '';
  const s = text.trim();
  if (s.length === 0) return '';
  if (/^\{\{[^}]+\}\}$/.test(s) || /\{\{product\./i.test(s)) return '';
  if (/^(?:null|undefined|none|n\/a|\{\}|\[\])$/i.test(s)) return '';
  if (/\b\d+\s+ads?\s+use\s+this\s+creative/i.test(s)) return '';
  if (/\b(?:EU\s+)?transparency\b/i.test(s) && s.length < 40) return '';
  if (/^(?:active|inactive|sponsored|report\s+ad|see\s+ad\s+details|about\s+the\s+advertiser|this\s+ad\s+has\s+multiple\s+versions|multiple\s+versions)$/i.test(s)) return '';
  if (/^(?:meta\s+)?ad\s+library$|^see\s+summary\s+details$|^estimated\s+audience\s+size:?$|^amount\s+spent(?:\s*\([^)]*\))?:?$|^categories$|^impressions:?$|^see\s+more$|^log\s*in$|^log\s*out$|^sign\s*up$|^search\s+ads$|^filter\s+results$/i.test(s)) return '';
  if (/^this ad was run by an account or page we later disabled/i.test(s)) return '';
  if (/^sorry, we're having trouble playing this video\.?$/i.test(s)) return '';
  if (/^(?:Started\s+running\s+on\s+|Library\s+ID:\s*)\d+/i.test(s)) return '';
  if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\s*[-–—~to\s]+(?:\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}|present)$/i.test(s)) return '';
  if (/^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\s*[-–—~to\s]+(?:\s*\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|present)$/i.test(s)) return '';
  if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}$/i.test(s)) return '';
  if (/^\d{4}-\d{2}-\d{2}\s*[-–—~to\s]+\s*\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  return s;
}

function countryEvidence(stats) {
  const basis = ['reached', 'targeted', 'listed'].includes(stats?.countryBasis)
    ? stats.countryBasis : 'unknown';
  const labels = { reached: 'Shown in', targeted: 'Audience locations',
    excluded: 'Excluded locations', listed: 'Meta-listed locations' };
  const titles = {
    reached: 'Meta reports that this ad reached people in these countries.',
    targeted: 'Countries included in this ad’s audience locations. Delivery is not confirmed.',
    excluded: 'Countries excluded from this ad’s audience locations.',
    listed: 'Meta lists these as targeted or reached countries without distinguishing which.',
  };
  const flags = {
    US: '🇺🇸', GB: '🇬🇧', CA: '🇨🇦', AU: '🇦🇺', NZ: '🇳🇿',
    DE: '🇩🇪', FR: '🇫🇷', IT: '🇮🇹', ES: '🇪🇸', NL: '🇳🇱',
    SE: '🇸🇪', NO: '🇳🇴', DK: '🇩🇰', FI: '🇫🇮', IE: '🇮🇪',
    CH: '🇨🇭', AT: '🇦🇹', BE: '🇧🇪', PL: '🇵🇱', SG: '🇸🇬',
    JP: '🇯🇵', KR: '🇰🇷', BR: '🇧🇷', MX: '🇲🇽',
  };
  const normalize = values => [...new Set((values || [])
    .map(value => String(value).toUpperCase())
    .filter(value => /^[A-Z]{2}$/.test(value) && value !== 'EN' && value !== 'ZZ'))];
  const reached = normalize(stats?.reachedCountries || (basis === 'reached' ? stats?.countries : []));
  const targeted = normalize(stats?.targetedCountries || (basis === 'targeted' ? stats?.countries : []));
  const excluded = normalize(stats?.excludedCountries);
  const listed = normalize(stats?.listedCountries || (basis === 'listed' ? stats?.countries : []));
  const preciseCodes = new Set([...reached, ...targeted, ...excluded]);
  const additionalListed = listed.filter(code => !preciseCodes.has(code));
  const rows = [
    ['reached', reached], ['targeted', targeted], ['excluded', excluded],
    ['listed', additionalListed],
  ].filter(([, codes]) => codes.length).map(([type, codes]) => ({
    label: labels[type], title: titles[type], value: codes.join(', '),
    withFlags: codes.map(code => `${flags[code] || ''} ${code}`.trim()).join(', '),
  }));
  const primary = rows.find(row => row.label !== labels.excluded) || null;
  return { rows, primary };
}

function knownDate(value) {
  if (!value || /^(?:unknown|recent|present)$/i.test(String(value).trim())) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// DOM References
const searchForm = document.getElementById('searchForm');
const searchInput = document.getElementById('searchInput');
const searchSubmitBtn = document.getElementById('searchSubmitBtn');
const searchClearBtn = document.getElementById('searchClearBtn');

const emptyState = document.getElementById('emptyState');
const loadingState = document.getElementById('loadingState');
const loadingTitle = document.getElementById('loadingTitle');
const loadingSubhead = document.getElementById('loadingSubhead');

const adGrid = document.getElementById('adGrid');
const paginationNav = document.getElementById('paginationNav');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageNumbersList = document.getElementById('pageNumbersList');
let searchInFlight = false;

// Quick Search from Suggestion Chips
window.executeQuickSearch = function (query) {
  if (!query || searchInFlight) return;
  if (searchInput) {
    searchInput.value = query;
    searchInput.blur(); // Dismiss mobile keyboard
  }
  if (searchClearBtn) {
    searchClearBtn.style.display = 'flex';
  }
  executeSearch(query, 1);
};

// Initialize Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  fetchHealth();

  if (searchClearBtn && searchInput) {
    searchInput.addEventListener('input', () => {
      searchClearBtn.style.display = searchInput.value.length > 0 ? 'flex' : 'none';
    });

    searchClearBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchClearBtn.style.display = 'none';
      searchInput.focus();
    });
  }

  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = searchInput.value.trim();
    if (val && !searchInFlight) {
      searchInput.blur(); // Close mobile soft keyboard so results are immediately visible
      executeSearch(val, 1);
    }
  });

  // Pagination navigation
  prevPageBtn.addEventListener('click', () => {
    if (state.currentPage > 1) changePage(state.currentPage - 1);
  });

  nextPageBtn.addEventListener('click', () => {
    if (state.currentPage < state.totalPages) changePage(state.currentPage + 1);
  });
});

async function fetchHealth() {
  try {
    await fetch('/api/health');
  } catch (e) {}
}

/**
 * Execute Search Pipeline against Backend (4-Stage AI Pipeline)
 */
async function executeSearch(targetInput, page = 1) {
  if (searchInFlight) return;
  searchInFlight = true;
  resetMediaSession();
  const searchGeneration = mediaGeneration;
  state.currentInput = targetInput;
  state.currentPage = page;

  // UI state transitions — hide stale content from previous search
  emptyState.style.display = 'none';
  adGrid.style.display = 'none';
  paginationNav.style.display = 'none';
  loadingState.style.display = 'block';
  searchSubmitBtn.disabled = true;
  searchSubmitBtn.setAttribute('aria-busy', 'true');

  // Staged progress remains visible while the server validates and archives media.
  const steps = [
    { label: 'Understanding your product...', detail: 'Building strict brand and product search vectors.', delay: 0 },
    { label: 'Searching live Meta ads...', detail: 'Collecting current campaigns from the public Ads Library.', delay: 2200 },
    { label: 'Verifying relevance with AI...', detail: 'Removing unrelated brands, noise, and duplicate creatives.', delay: 9000 },
    { label: 'Finishing live research...', detail: 'Meta may take longer when few ads match the exact name.', delay: 18000 },
    { label: 'Preparing results...', detail: 'Available previews load as cards come into view.', delay: 30000 },
  ];

  loadingState.innerHTML = `
    <div class="spinner"></div>
    <h3 id="loadingTitle">${steps[0].label}</h3>
    <p id="loadingSubhead">${steps[0].detail}</p>
    <div class="pipeline-meter" aria-hidden="true"><span id="pipelineMeterFill"></span></div>
    <div class="loading-progress" id="loadingProgress">
      ${steps.map((s, i) => `
        <div class="loading-step ${i === 0 ? 'active' : ''}" id="loadStep${i}">
          <span class="step-icon">${i === 0 ? '●' : '○'}</span>
          <span>${s.label}</span>
        </div>
      `).join('')}
    </div>
    <div class="loading-elapsed" id="loadingElapsed">0s</div>
  `;

  // Scroll loading UI into view on mobile so progress is fully visible
  requestAnimationFrame(() => {
    loadingState.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  const stepTimers = [];
  const searchStartTime = Date.now();
  const elapsedInterval = setInterval(() => {
    const el = document.getElementById('loadingElapsed');
    if (el) el.textContent = `${Math.floor((Date.now() - searchStartTime) / 1000)}s`;
  }, 1000);

  function setActiveStep(stepIndex) {
    for (let j = 0; j < steps.length; j++) {
      const stepEl = document.getElementById(`loadStep${j}`);
      if (!stepEl) continue;
      if (j < stepIndex) {
        stepEl.classList.remove('active');
        stepEl.classList.add('done');
        stepEl.querySelector('.step-icon').textContent = '✓';
      } else if (j === stepIndex) {
        stepEl.classList.remove('done');
        stepEl.classList.add('active');
        stepEl.querySelector('.step-icon').textContent = '●';
        const title = document.getElementById('loadingTitle');
        if (title) title.textContent = steps[j].label;
        const subhead = document.getElementById('loadingSubhead');
        if (subhead) subhead.textContent = steps[j].detail;
      } else {
        stepEl.classList.remove('active', 'done');
        stepEl.querySelector('.step-icon').textContent = '○';
      }
    }
    const fill = document.getElementById('pipelineMeterFill');
    if (fill) fill.style.width = `${Math.min(94, 8 + (stepIndex + 1) * (86 / steps.length))}%`;
  }

  steps.forEach((s, i) => {
    if (i === 0) return;
    stepTimers.push(setTimeout(() => setActiveStep(i), s.delay));
  });

  try {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: targetInput,
        countries: ['ALL'],
        status: 'ALL',
        mediaType: 'ALL',
        page: 1,
        pageSize: 100,
        // Every submitted search is live; media remains separately durable in Storage.
        useCache: false,
      }),
    });

    const responseText = await response.text();
    let data;
    try { data = JSON.parse(responseText); }
    catch {
      const detail = response.ok
        ? 'The search service returned an invalid response. Please retry.'
        : `The search service is temporarily unavailable (${response.status}). Please retry.`;
      throw new Error(detail);
    }
    if (!response.ok) throw new Error(data.error || `Search failed (${response.status})`);
    if (data.error) throw new Error(data.error);
    if (searchGeneration !== mediaGeneration) return;

    state.currentProfile = data.queryProfile;
    state.rawRankedAds = data.paginated.items;
    state.sourceAdsFound = Number(data.stats?.sourceAdsFound) || state.rawRankedAds.length;

    setActiveStep(4);

    // Populate any media already resolved by backend
    for (const ad of state.rawRankedAds || []) {
      if (ad.media && ad.media.mediaType !== 'unknown') {
        state.resolvedMediaMap[String(ad.id)] = ad.media;
      }
    }

    // Reveal results immediately; visible-card media is resolved lazily.
    loadingState.style.display = 'none';
    adGrid.style.display = 'grid';

    const fill = document.getElementById('pipelineMeterFill');
    if (fill) fill.style.width = '100%';
    applyFiltersAndRender(1);
    fetchHealth();
  } catch (err) {
    loadingState.style.display = 'none';
    emptyState.style.display = 'block';
    emptyState.innerHTML = `
      <div class="empty-icon">⚠️</div>
      <h3>Search Encountered An Issue</h3>
      <p style="color: var(--accent-danger); margin-top: 8px;">${err.message}</p>
      <button class="chip-btn" style="margin-top: 16px;" onclick="executeSearch(state.currentInput, 1)">Retry Search</button>
    `;
  } finally {
    stepTimers.forEach(t => clearTimeout(t));
    clearInterval(elapsedInterval);
    searchInFlight = false;
    if (searchGeneration === mediaGeneration) searchSubmitBtn.disabled = false;
    searchSubmitBtn.removeAttribute('aria-busy');
  }
}

/**
 * Direct Render & Pagination Function (Clean Pinterest Board)
 */
function applyFiltersAndRender(targetPage = 1) {
  state.currentPage = targetPage;
  const items = state.rawRankedAds || [];

  state.totalPages = Math.ceil(items.length / state.pageSize) || 1;
  const startIdx = (state.currentPage - 1) * state.pageSize;
  const pageItems = items.slice(startIdx, startIdx + state.pageSize);
  state.currentAds = pageItems;

  renderAdGrid(pageItems);
  renderPagination();

  // Lazily sniff media only when cards enter the viewport
  observeCardsForSniffing();
}






/**
 * Render Ad Cards into Grid
 */
function renderAdGrid(ads) {
  adGrid.querySelectorAll('.card-media-box').forEach(box => AdMedia.dispose(box));
  adGrid.innerHTML = '';

  if (!ads || ads.length === 0) {
    const query = (state.currentInput || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    adGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <h3>No Ads Found for "${query}"</h3>
        <p>Try a broader product term or another brand name.</p>
      </div>
    `;
    return;
  }

  ads.forEach((ad) => {
    const card = document.createElement('div');
    card.className = 'ad-card';
    card.id = `ad-card-${ad.id}`;
    card.setAttribute('data-ad-id', String(ad.id));

    const mediaHtml = '<div class="media-empty">Finding creative…</div>';

    const statusClass = ad.stats.isActive ? 'active' : 'inactive';
    const statusText = ad.stats.isActive ? 'Active' : 'Inactive';

    const country = countryEvidence(ad.stats);

    // Format platform chips from raw Meta data
    const rawPlatforms = Array.isArray(ad.stats?.platforms) ? ad.stats.platforms : [];

    const platformItems = rawPlatforms
      .map(p => {
        const clean = String(p).toLowerCase().replace(/_/g, ' ');
        if (clean.includes('facebook')) return 'Facebook';
        if (clean.includes('instagram')) return 'Instagram';
        if (clean.includes('audience')) return 'Audience Network';
        if (clean.includes('messenger')) return 'Messenger';
        if (clean.includes('whatsapp')) return 'WhatsApp';
        if (clean.includes('threads')) return 'Threads';
        return clean.charAt(0).toUpperCase() + clean.slice(1);
      })
      .filter((v, i, a) => a.indexOf(v) === i);

    const platformPillsHtml = platformItems
      .map(name => `<span class="platform-chip platform-${name.toLowerCase().replace(/\s+/g, '-')}">${name}</span>`)
      .join('');

    // Format start date
    const startDate = knownDate(ad.stats?.startDate)?.toLocaleDateString('en-US',
      { month: 'short', day: 'numeric', year: 'numeric' }) || '';
    const hasFlightDuration = Boolean(startDate && Number.isFinite(Number(ad.stats?.flightDays))
      && Number(ad.stats.flightDays) > 0);

    // Format EU Reach (ONLY display when available and > 0)
    const rawEuReach = ad.stats?.euTotalReach || ad.stats?.euReach;
    const hasEuReach = rawEuReach && !isNaN(rawEuReach) && Number(rawEuReach) > 0;
    const euReachFormatted = hasEuReach
      ? (Number(rawEuReach) >= 1000 ? `${(Number(rawEuReach) / 1000).toFixed(1)}K` : String(rawEuReach))
      : null;

    const variantCount = (ad.variants && ad.variants.length > 0) ? ad.variants.length : (ad.variantCount || 1);
    const cleanBody = cleanCopy(ad.copy?.body);
    const cleanHeadline = cleanCopy(ad.copy?.headline);
    const cleanDesc = cleanCopy(ad.copy?.description);
    const hasAnyCopy = Boolean(cleanBody || cleanHeadline || cleanDesc);

    // Initialize active variant index
    ad.activeVariantIndex = 0;

    card.innerHTML = `
      <div class="card-header">
        <div class="advertiser-info">
          <span class="advertiser-name" title="${ad.pageName}">${ad.pageName}</span>
        </div>
        <div class="card-status-badge ${statusClass}">
          <span class="status-dot"></span>
          ${statusText}
        </div>
      </div>

      <div class="card-media-box" id="media-box-${ad.id}">
        ${mediaHtml}
      </div>

      <div class="card-destination-strip" id="card-dest-${ad.id}" style="${ad.destinationUrl || ad.displayDomain ? '' : 'display:none;'}" onclick="event.stopPropagation(); window.openOutboundUrl('${ad.id}')" title="Visit landing page (opens in new tab)" role="button" tabindex="0">
        <span class="card-dest-domain" title="${ad.destinationUrl || ad.displayDomain || ''}">🌐 ${ad.displayDomain || 'Website'}</span>
        <span class="card-dest-cta">${ad.ctaText || 'Learn More'} ↗</span>
      </div>

      ${hasFlightDuration || startDate || euReachFormatted || country.primary ? `<div class="card-stats-strip">
        ${hasFlightDuration ? `<div class="stat-item">
          <span class="stat-label">Duration</span>
          <span class="stat-value">
            ${ad.stats.flightDays} day${ad.stats.flightDays === 1 ? '' : 's'}
          </span>
        </div>` : ''}
        ${euReachFormatted ? `
          <div class="stat-item" title="Official EU Verified Audience Reach returned by Meta">
            <span class="stat-label">EU Reach</span>
            <span class="stat-value">🇪🇺 ${euReachFormatted}</span>
          </div>
        ` : ''}
        ${startDate ? `<div class="stat-item">
          <span class="stat-label">Started</span>
          <span class="stat-value">${startDate}</span>
        </div>` : ''}
        ${country.primary ? `<div class="stat-item" title="${country.primary.title}">
          <span class="stat-label">${country.primary.label}</span>
          <span class="stat-value" style="font-size: 0.76rem; font-weight: 600;">${country.primary.withFlags}</span>
        </div>` : ''}
      </div>` : ''}

      ${platformItems.length ? `<div class="card-platforms-row">
        <span class="meta-label">Platforms:</span>
        <div class="platform-chips-wrap">
          ${platformPillsHtml}
        </div>
      </div>` : ''}

      <!-- In-Card Variant Carousel Controller (Shown only when multiple variants exist) -->
      ${variantCount > 1 ? `
        <div class="card-variant-carousel-bar">
          <div class="variant-carousel-nav">
            <button type="button" class="variant-nav-arrow" onclick="event.stopPropagation(); flipCardVariant('${ad.id}', -1)" title="Previous copy variant" aria-label="Previous variant">‹</button>
            <span class="variant-step-counter" id="var-counter-${ad.id}">
              Variant <b>1</b> of ${variantCount}
            </span>
            <button type="button" class="variant-nav-arrow" onclick="event.stopPropagation(); flipCardVariant('${ad.id}', 1)" title="Next copy variant" aria-label="Next variant">›</button>
          </div>
        </div>
      ` : ''}

      <div class="card-copy-content" id="copy-content-${ad.id}">
        <!-- 1. Primary Text (Post Copy) -->
        <div class="copy-section copy-section-body" id="body-wrap-${ad.id}" style="${cleanBody ? '' : 'display:none;'}">
          <span class="copy-label-tag tag-primary">Primary Text</span>
          <p class="ad-body-text" id="body-text-${ad.id}">${cleanBody}</p>
          ${cleanBody && cleanBody.length > 110 ? `<button type="button" class="show-more-btn" id="show-more-btn-${ad.id}" onclick="event.stopPropagation(); toggleCopy('${ad.id}')">Read more</button>` : ''}
        </div>

        <!-- 2. Headline / Title -->
        <div class="copy-section copy-section-headline" id="headline-wrap-${ad.id}" style="${cleanHeadline ? '' : 'display:none;'}">
          <span class="copy-label-tag tag-headline">Headline</span>
          <h4 class="ad-headline" id="headline-${ad.id}">${cleanHeadline}</h4>
        </div>

        <!-- 3. Link Description -->
        <div class="copy-section copy-section-desc" id="desc-wrap-${ad.id}" style="${cleanDesc ? '' : 'display:none;'}">
          <span class="copy-label-tag tag-desc">Description</span>
          <p class="ad-desc-snippet" id="desc-snippet-${ad.id}">${cleanDesc}</p>
        </div>

        <!-- Clean fallback when no text copy accompanies this creative -->
        <div class="copy-empty-state" id="copy-empty-${ad.id}" style="${hasAnyCopy ? 'display:none;' : ''}">
          <span>📝</span> No copy text provided with this creative
        </div>
      </div>
    `;

    adGrid.appendChild(card);
  });

  initializeGridMedia();
}

/** Media lifecycle: one request per ad, one automatic refresh, no stale-search patches. */
let mediaGeneration = 0;
let cardObserver;
let sniffDebounceTimer;
let sniffRunning = false;
const pendingSniffQueue = new Set();
const mediaRequests = new Map();
const creativeIndices = new Map();
const mediaRefreshAttempts = new Set();

function resetMediaSession() {
  mediaGeneration++;
  pendingSniffQueue.clear();
  clearTimeout(sniffDebounceTimer);
  cardObserver?.disconnect();
  adGrid.querySelectorAll('.card-media-box').forEach(box => AdMedia.dispose(box));
  state.resolvedMediaMap = {};
  state.blockedAdIds.clear();
  creativeIndices.clear();
  mediaRefreshAttempts.clear();
}

function currentMedia(ad) {
  const media = state.resolvedMediaMap[ad.id] || ad.media;
  if (!media) return null;
  if (media.schemaVersion === 2) return media;
  if (media.thumbnailUrl || media.videoUrl || (Array.isArray(media.creatives) && media.creatives.length > 0)) {
    return {
      schemaVersion: 2,
      status: media.status || 'ready',
      mediaType: media.mediaType || (media.videoUrl ? 'video' : 'image'),
      thumbnailUrl: media.thumbnailUrl || null,
      videoUrl: media.videoUrl || null,
      creatives: Array.isArray(media.creatives) && media.creatives.length > 0
        ? media.creatives
        : [{
            mediaType: media.mediaType || (media.videoUrl ? 'video' : 'image'),
            thumbnailUrl: media.thumbnailUrl || null,
            videoUrl: media.videoUrl || null,
          }],
      destinationUrl: media.destinationUrl || ad.destinationUrl || null,
      ctaText: media.ctaText || ad.ctaText || null,
    };
  }
  return media.status === 'blocked' ? media : null;
}

function initializeGridMedia() {
  for (const ad of state.currentAds || []) {
    const box = document.getElementById(`media-box-${ad.id}`);
    if (box && !box.dataset.initialized) renderAdMedia(ad, box);
  }
}

function renderAdMedia(ad, box = document.getElementById(`media-box-${ad.id}`)) {
  if (!box) return;
  box.dataset.initialized = 'true';
  const generation = mediaGeneration;
  AdMedia.render(box, {
    adId: String(ad.id), media: currentMedia(ad), index: creativeIndices.get(String(ad.id)) || 0,
    displayFormat: ad.display_format || currentMedia(ad)?.displayFormat || null,
    onIndexChange: index => creativeIndices.set(String(ad.id), index),
    onRefresh: () => {
      const id = String(ad.id);
      if (generation !== mediaGeneration || mediaRefreshAttempts.has(id)) return;
      mediaRefreshAttempts.add(id);
      requestAdMedia(ad, { forceRefresh: true }).then(() => {
        if (box.id === 'modalMediaBox' && box.isConnected
            && String(window._currentModalAd?.id) === id) renderAdMedia(ad, box);
      });
    },
  });
  if (box.id === 'modalMediaBox' && !currentMedia(ad)) {
    requestAdMedia(ad).then(() => {
      if (generation === mediaGeneration && box.isConnected
          && String(window._currentModalAd?.id) === String(ad.id)) renderAdMedia(ad, box);
    });
  }
}

async function requestAdMedia(ad, { forceRefresh = false } = {}) {
  const generation = mediaGeneration;
  const id = String(ad.id);
  const key = `${generation}:${id}:${forceRefresh ? 'refresh' : 'initial'}`;
  if (mediaRequests.has(key)) return mediaRequests.get(key);
  const request = (async () => {
    let media;
    try {
      const response = await fetch('/api/sniff-page', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ads: [{ id, adSnapshotUrl: ad.adSnapshotUrl || null,
          media: forceRefresh ? null : currentMedia(ad) }], forceRefresh }),
        signal: AbortSignal.timeout(90000),
      });
      if (!response.ok) throw new Error('Preview request failed');
      const data = await response.json();
      media = data.mediaMap?.[id];
      if (!media) throw new Error('Missing preview');
    } catch {
      media = { schemaVersion: 2, status: 'retryable_failure', creatives: [], mediaType: 'unknown' };
    }
    if (generation === mediaGeneration) {
      if (media.status === 'blocked' && !currentMedia(ad)?.creatives?.length) {
        state.blockedAdIds.add(id);
      }
      // Retain media resolution (ready, blocked fallback, or unavailable)
      if (forceRefresh || media.status === 'ready' || !currentMedia(ad)) state.resolvedMediaMap[id] = media;
      if (media.destinationUrl) {
        ad.destinationUrl = media.destinationUrl;
        try { ad.displayDomain = new URL(media.destinationUrl).hostname.replace(/^www\./, ''); } catch {}
      }
      if (media.ctaText) ad.ctaText = media.ctaText;
      const strip = document.getElementById(`card-dest-${id}`);
      if (strip) {
        if (ad.destinationUrl || ad.displayDomain) strip.style.display = '';
        const domain = strip.querySelector('.card-dest-domain');
        const cta = strip.querySelector('.card-dest-cta');
        if (domain) { domain.textContent = `🌐 ${ad.displayDomain || 'Website'}`; domain.title = ad.destinationUrl || ''; }
        if (cta) cta.textContent = `${ad.ctaText || 'Learn More'} ↗`;
      }
      renderAdMedia(ad);
    }
    return media;
  })();
  mediaRequests.set(key, request);
  try { return await request; } finally { mediaRequests.delete(key); }
}

function observeCardsForSniffing() {
  cardObserver?.disconnect();
  const queue = ad => {
    const media = currentMedia(ad);
    if (!media || (media.status === 'ready' && !['ready', 'partial'].includes(media.storageStatus))) {
      pendingSniffQueue.add(String(ad.id));
    }
    scheduleFlushSniffQueue();
  };
  if (!window.IntersectionObserver) {
    (state.currentAds || []).forEach(queue);
    return;
  }
  cardObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const ad = (state.currentAds || []).find(a => String(a.id) === entry.target.dataset.adId);
      if (ad) queue(ad);
      cardObserver.unobserve(entry.target);
    }
  }, { rootMargin: '250px' });
  document.querySelectorAll('.ad-card').forEach(card => cardObserver.observe(card));
}

function scheduleFlushSniffQueue() {
  if (sniffRunning) return;
  clearTimeout(sniffDebounceTimer);
  sniffDebounceTimer = setTimeout(async () => {
    const generation = mediaGeneration;
    const ads = (state.currentAds || []).filter(ad => pendingSniffQueue.has(String(ad.id))).slice(0, 2);
    if (!ads.length) return;
    sniffRunning = true;
    ads.forEach(ad => pendingSniffQueue.delete(String(ad.id)));
    try {
      await Promise.all(ads.map(async ad => {
        await requestAdMedia(ad);
        if (generation === mediaGeneration) renderAdMedia(ad);
      }));
    } finally {
      sniffRunning = false;
      if (pendingSniffQueue.size) scheduleFlushSniffQueue();
    }
  }, 100);
}

function sniffMediaForCurrentPage() { observeCardsForSniffing(); }

/**
 * Flip between tested variants directly on the card (Grid carousel)
 */
window.flipCardVariant = function (adId, direction) {
  const ad = (state.currentAds || []).find((a) => String(a.id) === String(adId));
  if (!ad || !ad.variants || ad.variants.length <= 1) return;

  ad.activeVariantIndex = ad.activeVariantIndex || 0;
  const total = ad.variants.length;
  ad.activeVariantIndex = (ad.activeVariantIndex + direction + total) % total;
  const v = ad.variants[ad.activeVariantIndex];

  const cleanBody = cleanCopy(v.body);
  const cleanHeadline = cleanCopy(v.headline);
  const cleanDesc = cleanCopy(v.description);
  const hasAny = Boolean(cleanBody || cleanHeadline || cleanDesc);

  // Update primary body text
  const bodyEl = document.getElementById(`body-text-${adId}`);
  const bodyWrap = document.getElementById(`body-wrap-${adId}`);
  const moreBtn = document.getElementById(`show-more-btn-${adId}`);
  if (bodyEl) {
    bodyEl.textContent = cleanBody;
    bodyEl.classList.remove('expanded');
  }
  if (bodyWrap) bodyWrap.style.display = cleanBody ? 'flex' : 'none';
  if (moreBtn) {
    moreBtn.textContent = 'Read more';
    moreBtn.style.display = (cleanBody && cleanBody.length > 110) ? 'inline-block' : 'none';
  }

  // Update headline
  const headlineEl = document.getElementById(`headline-${adId}`);
  const headlineWrap = document.getElementById(`headline-wrap-${adId}`);
  if (headlineEl) headlineEl.textContent = cleanHeadline;
  if (headlineWrap) headlineWrap.style.display = cleanHeadline ? 'flex' : 'none';

  // Update description snippet
  const descEl = document.getElementById(`desc-snippet-${adId}`);
  const descWrap = document.getElementById(`desc-wrap-${adId}`);
  if (descEl) descEl.textContent = cleanDesc;
  if (descWrap) descWrap.style.display = cleanDesc ? 'flex' : 'none';

  // Update empty state fallback
  const emptyEl = document.getElementById(`copy-empty-${adId}`);
  if (emptyEl) emptyEl.style.display = hasAny ? 'none' : 'flex';

  // Update counter badge
  const counterEl = document.getElementById(`var-counter-${adId}`);
  if (counterEl) {
    counterEl.innerHTML = `Variant <b>${ad.activeVariantIndex + 1}</b> of ${total}`;
  }
};

/**
 * Copy currently active variant headline and body
 */
window.copyActiveVariantCopy = function (adId, btn) {
  const ad = (state.currentAds || []).find((a) => String(a.id) === String(adId));
  if (!ad) return;

  const idx = ad.activeVariantIndex || 0;
  const v = (ad.variants && ad.variants[idx]) || { headline: ad.copy?.headline, body: ad.copy?.body };
  const h = cleanCopy(v.headline);
  const b = cleanCopy(v.body);
  const text = [h, b].filter(Boolean).join('\n\n');
  if (!text) {
    copyToClipboard('No copy text', btn, '⚠️ No Copy');
    return;
  }
  copyToClipboard(text, btn, '✅ Copied Copy!');
};

/**
 * Outbound Landing Page Navigation (Opens advertiser destination in new tab)
 */
window.openOutboundUrl = function (adId) {
  const ad = (state.currentAds || []).find((a) => String(a.id) === String(adId));
  const url = ad?.destinationUrl || (state.resolvedMediaMap[adId]?.destinationUrl);
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

/**
 * Toggle Body Copy Read More / Show Less
 */
window.toggleCopy = function (adId) {
  const p = document.getElementById(`body-text-${adId}`);
  const btn = document.getElementById(`show-more-btn-${adId}`);
  if (!p) return;
  if (p.classList.contains('expanded')) {
    p.classList.remove('expanded');
    if (btn) btn.textContent = 'Read more';
  } else {
    p.classList.add('expanded');
    if (btn) btn.textContent = 'Show less';
  }
};

/**
 * Pagination Controls
 */
function renderPagination() {
  if (state.totalPages <= 1) {
    paginationNav.style.display = 'none';
    return;
  }

  paginationNav.style.display = 'flex';
  prevPageBtn.disabled = state.currentPage <= 1;
  nextPageBtn.disabled = state.currentPage >= state.totalPages;

  pageNumbersList.innerHTML = '';
  for (let p = 1; p <= state.totalPages; p++) {
    const btn = document.createElement('button');
    btn.className = `page-num ${p === state.currentPage ? 'active' : ''}`;
    btn.textContent = p;
    btn.addEventListener('click', () => changePage(p));
    pageNumbersList.appendChild(btn);
  }
}

function changePage(newPage) {
  if (newPage < 1 || newPage > state.totalPages || newPage === state.currentPage) return;
  // Cards are available immediately; only visible previews are resolved in
  // the background. Pagination must not wait on ten Meta detail pages.
  applyFiltersAndRender(newPage);
  const targetEl = document.getElementById('resultsSection') || document.getElementById('adGrid');
  if (targetEl) {
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}


window.copyToClipboard = function (text, btnElement, successMsg = '✅ Copied!') {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    if (btnElement) {
      const orig = btnElement.innerHTML;
      btnElement.innerHTML = successMsg;
      setTimeout(() => { btnElement.innerHTML = orig; }, 2000);
    }
  });
};

window.copyAssetLink = function (url, btnElement) {
  if (!url) return;
  copyToClipboard(url, btnElement, '✅ Copied Link!');
};

/**
 * Interactive In-App Variant Explorer & Creative Inspector Modal
 */
window.openVariantsModal = function (adId) {
  const ad = (state.rawRankedAds || []).find(a => String(a.id) === String(adId))
          || (state.currentAds || []).find(a => String(a.id) === String(adId));
  if (!ad) return;

  const modal = document.getElementById('variantsModal');
  const advertiserEl = document.getElementById('modalAdvertiser');
  const avatarEl = document.getElementById('modalBrandAvatar');
  const badgeEl = document.getElementById('modalRelBadge');
  const metaSubEl = document.getElementById('modalMetaSub');

  if (!modal) return;

  const pageName = ad.pageName || 'Advertiser';
  if (advertiserEl) advertiserEl.textContent = pageName;
  if (avatarEl) avatarEl.textContent = pageName.charAt(0).toUpperCase();

  if (badgeEl) badgeEl.innerHTML = '';

  const hasFlightDuration = knownDate(ad.stats?.startDate)
    && Number.isFinite(Number(ad.stats?.flightDays)) && Number(ad.stats.flightDays) > 0;
  const statusStr = hasFlightDuration
    ? `${ad.stats?.isActive ? 'Active for' : 'Ran for'} ${ad.stats.flightDays} days`
    : (ad.stats?.isActive ? 'Active' : 'Inactive');
  if (metaSubEl) metaSubEl.textContent = `Meta Ad ID: ${ad.id} • ${statusStr}`;

  window._currentModalAd = ad;
  window._currentVariantIdx = 0;

  document.querySelectorAll('.creative-viewer video').forEach(v => v.pause());
  renderModalContent(ad, 0);

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
};

window.closeVariantsModal = function (e) {
  if (e && e.target && e.target.id !== 'variantsModal' && !e.target.classList.contains('modal-close-btn')) {
    return;
  }
  const modal = document.getElementById('variantsModal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
  const mediaBox = document.getElementById('modalMediaBox');
  if (mediaBox) AdMedia.dispose(mediaBox);
};

window.switchModalVariant = function (idx) {
  if (!window._currentModalAd) return;
  window._currentVariantIdx = idx;
  renderModalContent(window._currentModalAd, idx);
};

function renderModalContent(ad, activeIdx = 0) {
  const bodyEl = document.getElementById('modalBody');
  if (!bodyEl) return;
  const country = countryEvidence(ad.stats);

  const variants = (ad.variants && ad.variants.length > 0) ? ad.variants : [{
    index: 1,
    headline: ad.copy?.headline || '',
    body: ad.copy?.body || '',
    description: ad.copy?.description || '',
    caption: ad.displayDomain || ad.copy?.caption || '',
    startDate: ad.stats?.startDate || null,
    euTotalReach: ad.stats?.euTotalReach || null,
  }];

  const currentVariant = variants[activeIdx] || variants[0];
  const cleanHeadline = cleanCopy(currentVariant.headline);
  const cleanBody = cleanCopy(currentVariant.body);
  const cleanDesc = cleanCopy(currentVariant.description);
  const hasAnyCopy = Boolean(cleanHeadline || cleanBody || cleanDesc);

  const oldMediaBox = document.getElementById('modalMediaBox');
  if (oldMediaBox) AdMedia.dispose(oldMediaBox);
  const mediaHtml = '<div class="modal-media-wrap" id="modalMediaBox"></div>';

  // Build Variant Tabs
  let variantTabsHtml = '';
  if (variants.length > 1) {
    const tabsList = variants.map((v, i) => `
      <button type="button" class="variant-tab-chip ${i === activeIdx ? 'active' : ''}" onclick="switchModalVariant(${i})">
        Variant ${i + 1}
      </button>
    `).join('');

    variantTabsHtml = `
      <div class="variant-tabs-container">
        <div class="variant-tabs-header">
          <span class="variant-tabs-label">Tested Copy Variations (${variants.length})</span>
          <span style="font-size: 0.72rem; color: var(--accent-primary); font-weight: 700;">Viewing #${activeIdx + 1}</span>
        </div>
        <div class="variant-tabs-scroll">
          ${tabsList}
        </div>
      </div>
    `;
  }

  const rawEuReach = currentVariant.euTotalReach || ad.stats?.euTotalReach;
  const hasEuReach = rawEuReach && !isNaN(rawEuReach) && Number(rawEuReach) > 0;
  const euReachText = hasEuReach ? `🇪🇺 ${Number(rawEuReach).toLocaleString()} EU Users` : null;
  const launchDate = knownDate(currentVariant.startDate || ad.stats?.startDate)
    ?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) || null;
  const hasFlightDuration = Boolean(knownDate(ad.stats?.startDate)
    && Number.isFinite(Number(ad.stats?.flightDays))
    && Number(ad.stats.flightDays) > 0);
  const destUrl = ad.destinationUrl || (ad.displayDomain ? `https://${ad.displayDomain}` : '');

  bodyEl.innerHTML = `
    <div class="modal-split-body">
      <!-- Left Column: Visual Media Preview & Direct Landing Page -->
      <div class="modal-left-col">
        <div class="modal-media-canvas" style="display: flex; flex-direction: column; width: 100%; gap: 14px;">
          ${mediaHtml}
          ${destUrl ? `
            <a href="${destUrl}" target="_blank" rel="noopener noreferrer" class="modal-dest-row" title="Open product sales page">
              <div style="display: flex; align-items: center; gap: 8px; overflow: hidden;">
                <span style="font-size: 1rem;">🌐</span>
                <span style="font-size: 0.82rem; font-weight: 700; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                  ${ad.displayDomain || 'Visit Product Website'}
                </span>
              </div>
              <span style="font-size: 0.75rem; font-weight: 700; color: var(--accent-primary);">
                ${ad.ctaText || 'Shop Now'} ↗
              </span>
            </a>
          ` : ''}

          <!-- Verified Meta Stats Table -->
          ${hasFlightDuration || euReachText || country.rows.length || launchDate ? `<div class="meta-stats-grid">
            ${hasFlightDuration ? `<div class="meta-stat-cell">
              <span class="meta-stat-label">Flight Duration</span>
              <span class="meta-stat-val">${ad.stats.flightDays} ${ad.stats?.isActive ? 'Days Active' : 'Days'}</span>
            </div>` : ''}
            ${euReachText ? `
              <div class="meta-stat-cell">
                <span class="meta-stat-label">EU Reach</span>
                <span class="meta-stat-val" style="color: #1d4ed8;">${euReachText}</span>
              </div>
            ` : ''}
            ${country.rows.map(row => `<div class="meta-stat-cell">
              <span class="meta-stat-label" title="${row.title}">${row.label}</span>
              <span class="meta-stat-val">${row.value}</span>
            </div>`).join('')}
            ${launchDate ? `<div class="meta-stat-cell">
              <span class="meta-stat-label">Launch Date</span>
              <span class="meta-stat-val">${launchDate}</span>
            </div>` : ''}
          </div>` : ''}
        </div>
      </div>

      <!-- Right Column: Interactive Variant Explorer & Copy Inspector -->
      <div class="modal-right-col">
        ${variantTabsHtml}

        ${!hasAnyCopy ? `
          <div class="modal-no-copy-banner">
            <span>ℹ️</span> This creative ran without accompanying text copy (common for visual-first Stories, Reels, and image catalog placements).
          </div>
        ` : `
          <!-- Headline Box -->
          ${cleanHeadline ? `
            <div class="modal-copy-section">
              <div class="copy-box-header">
                <span class="modal-section-label">Ad Headline</span>
                <button type="button" class="copy-action-btn" onclick="copyToClipboard('${cleanHeadline.replace(/'/g, "\\'")}', this)">📋 Copy</button>
              </div>
              <h4 class="modal-headline">${cleanHeadline}</h4>
            </div>
          ` : ''}

          <!-- Primary Body Copy Box -->
          <div class="modal-copy-section">
            <div class="copy-box-header">
              <span class="modal-section-label">Primary Ad Copy</span>
              ${cleanBody ? `
                <button type="button" class="copy-action-btn" onclick="copyToClipboard('${cleanBody.replace(/'/g, "\\'").replace(/\n/g, '\\n')}', this)">📋 Copy Body</button>
              ` : ''}
            </div>
            <div class="${cleanBody ? 'modal-body-text' : 'modal-copy-empty'}">
              ${cleanBody || 'No primary copy text provided with this creative'}
            </div>
          </div>

          <!-- Secondary Link Description Box -->
          ${cleanDesc ? `
            <div class="modal-copy-section">
              <div class="copy-box-header">
                <span class="modal-section-label">Link Subtitle / Description</span>
                <button type="button" class="copy-action-btn" onclick="copyToClipboard('${cleanDesc.replace(/'/g, "\\'")}', this)">📋 Copy</button>
              </div>
              <p style="font-size: 0.8rem; color: var(--text-secondary); font-style: italic;">${cleanDesc}</p>
            </div>
          ` : ''}
        `}

        <!-- Outbound Product Landing Page Button -->
        <div style="margin-top: auto; padding-top: 14px; border-top: 1px solid var(--border-subtle);">
          <button type="button" class="view-ad-btn" style="background: var(--accent-primary); color: #ffffff; border-color: var(--accent-primary);" onclick="window.openOutboundUrl('${ad.id}')">
            Visit Product Sales Page (${ad.displayDomain || 'Store'}) ↗
          </button>
        </div>
      </div>
    </div>
  `;
  renderAdMedia(ad, document.getElementById('modalMediaBox'));
}
