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

// ─── AdMedia Component (DOM-based Safe Renderer with Carousel & Shimmer) ───
window.AdMedia = window.AdMedia || (() => {
  const instances = new WeakMap();
  const url = value => {
    try { const u = new URL(value, location.origin); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; }
    catch { return null; }
  };
  const sources = values => [...new Set(values.map(url).filter(Boolean))];
  function render(container, options) {
    if (!container) return;
    instances.get(container)?.();
    const { media, onRefresh } = options;
    const creatives = (media?.creatives?.length ? media.creatives : media ? [media] : [])
      .filter(c => c.videoUrl || c.thumbnailUrl || c.videoSources?.length || c.imageSources?.length);
    const index = Math.max(0, Math.min(options.index || 0, creatives.length - 1));
    const creative = creatives[index];
    let disposed = false;
    let timer;
    let observer;
    let player;
    let refreshing = false;
    const cleanup = () => {
      disposed = true;
      clearTimeout(timer);
      observer?.disconnect();
      if (player) { player.pause(); player.removeAttribute('src'); player.load(); }
    };
    instances.set(container, cleanup);
    container.replaceChildren();
    const viewer = document.createElement('div');
    viewer.className = 'creative-viewer';
    container.append(viewer);
    const stage = document.createElement('div');
    stage.className = 'creative-stage';
    viewer.append(stage);
    const message = document.createElement('div');
    message.className = 'media-status';
    message.setAttribute('role', 'status');
    viewer.append(message);

    function status(text, retry = false, retryLabel = 'Retry preview') {
      message.replaceChildren();
      const label = document.createElement('span');
      label.textContent = text;
      message.append(label);
      message.hidden = !text;
      if (retry && onRefresh) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = retryLabel;
        button.onclick = event => { event.stopPropagation(); refresh(true); };
        message.append(button);
      }
    }
    function dimensions(width, height) {
      if (width > 0 && height > 0) stage.style.aspectRatio = `${width} / ${height}`;
    }
    async function refresh(manual = false) {
      if (disposed || refreshing || !onRefresh) return;
      refreshing = true;
      status('Refreshing preview…');
      let updated;
      try { updated = await onRefresh(manual); } catch { /* Keep the surviving poster. */ }
      if (disposed || !container.isConnected) return;
      refreshing = false;
      if (updated?.status === 'ready') render(container, { ...options, media: updated, index });
      else status('Preview unavailable. You can retry.', true);
    }
    function failed(text) {
      clearTimeout(timer);
      status(text, true);
      refresh(false);
    }
    if (!creative) {
      stage.classList.add('media-empty');
      if (!media) {
        stage.classList.add('is-loading');
        stage.innerHTML = '<div class="media-empty-spinner"></div><span>Finding creative…</span>';
      } else {
        stage.classList.remove('is-loading');
        stage.textContent = media.status === 'blocked' ? 'Meta could not provide this preview.' : 'Preview unavailable';
        status('No preview available.', true);
      }
      return;
    }
    dimensions(creative.width, creative.height);
    if (creatives.length > 1) {
      const nav = document.createElement('div'); nav.className = 'media-navigation';
      for (const [direction, label] of [[-1, 'Previous creative'], [1, 'Next creative']]) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = direction < 0 ? '‹' : '›';
        button.setAttribute('aria-label', label);
        button.onclick = event => {
          event.stopPropagation();
          const next = (index + direction + creatives.length) % creatives.length;
          options.onIndexChange?.(next);
          render(container, { ...options, index: next });
        };
        nav.append(button);
        if (direction < 0) {
          const counter = document.createElement('span');
          counter.textContent = `Creative ${index + 1} of ${creatives.length}`;
          nav.append(counter);
        }
      }
      viewer.append(nav);
    }
    const videos = sources([creative.videoUrl, ...(creative.videoSources || [])]);
    const images = sources([creative.thumbnailUrl, ...(creative.imageSources || [])]);
    function showImage(asFallback = false) {
      if (!images.length) {
        stage.classList.remove('is-loading');
        stage.replaceChildren();
        stage.classList.add('media-empty');
        stage.textContent = 'Preview unavailable';
        return;
      }
      stage.classList.add('is-loading');
      const image = document.createElement('img');
      image.alt = `Ad creative ${index + 1}`;
      image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
      let sourceIndex = 0;
      image.onload = () => {
        clearTimeout(timer);
        stage.classList.remove('is-loading');
        image.classList.add('media-ready');
        dimensions(image.naturalWidth, image.naturalHeight);
        if (!asFallback && creative.mediaType === 'video' && !videos.length) {
          // Meta often exposes a video poster in search results before a stream
          // URL. Preserve the useful poster; do not auto-open a detail page
          // that may be blocked and incorrectly replace it with an error state.
          status('Video poster available.', false);
        } else if (!asFallback) status('');
      };
      image.onerror = () => {
        if (disposed) return;
        if (++sourceIndex < images.length) image.src = images[sourceIndex];
        else {
          stage.classList.remove('is-loading');
          image.remove();
          stage.classList.add('media-empty');
          stage.textContent = 'Image unavailable';
          failed('Could not load this image.');
        }
      };
      stage.replaceChildren(image);
      image.src = images[0];
      timer = setTimeout(() => {
        if (!disposed && !image.complete) {
          stage.classList.remove('is-loading');
          failed('Image is taking too long to load.');
        }
      }, 25000);
    }
    function activate() {
      if (disposed) return;
      observer?.disconnect();
      if (!videos.length) { showImage(); return; }
      stage.classList.add('is-loading');
      player = document.createElement('video');
      player.controls = true; player.playsInline = true; player.muted = true;
      player.loop = true; player.preload = 'metadata';
      player.setAttribute('aria-label', `Ad video ${index + 1}`);
      if (images[0]) player.poster = images[0];
      let sourceIndex = 0;
      const onReady = () => {
        clearTimeout(timer);
        stage.classList.remove('is-loading');
        player.classList.add('media-ready');
        dimensions(player.videoWidth, player.videoHeight);
        status('');
      };
      player.onloadedmetadata = onReady;
      player.oncanplay = onReady;
      player.onplay = () => {
        document.querySelectorAll('.creative-viewer video').forEach(other => { if (other !== player) other.pause(); });
      };
      player.onerror = () => {
        if (disposed) return;
        clearTimeout(timer);
        stage.classList.remove('is-loading');
        if (++sourceIndex < videos.length) { player.src = videos[sourceIndex]; player.load(); }
        else { showImage(true); failed('Video unavailable; showing its poster when available.'); }
      };
      stage.replaceChildren(player);
      player.src = videos[0];
      timer = setTimeout(() => {
        if (!disposed && player.readyState === 0) {
          stage.classList.remove('is-loading');
          showImage(true);
          failed('Video is taking too long to load.');
        }
      }, 25000);
      if (images.length) {
        const probe = new Image();
        let posterIndex = 0;
        probe.onerror = () => {
          if (disposed) return;
          if (++posterIndex < images.length) { player.poster = images[posterIndex]; probe.src = images[posterIndex]; }
          else { player.removeAttribute('poster'); failed('Poster unavailable; the video may still play.'); }
        };
        probe.src = images[0];
      }
    }
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) activate(); }, { rootMargin: '250px' });
      observer.observe(container);
    } else activate();
  }
  function dispose(container) { instances.get(container)?.(); instances.delete(container); }
  return { render, dispose };
})();
const AdMedia = window.AdMedia;

// Application State
const state = {
  currentInput: '',
  currentPage: 1,
  pageSize: 10,
  totalPages: 1,
  rawRankedAds: [],       // All ads returned by server
  sourceAdsFound: 0,      // Raw Ads Library records before creative deduplication
  currentProfile: null,
  currentFilter: 'ALL',   // 'ALL' | 'BRAND_AFFILIATE' | 'COMPETITOR'
  filters: { platform: '', language: '', country: '', status: '', creative: '' },
  resolvedMediaMap: {},   // adId -> { thumbnailUrl, videoUrl, mediaType }
};

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
const resultsFilters = document.getElementById('resultsFilters');
const filterResultCount = document.getElementById('filterResultCount');
const filterInputs = {
  platform: document.getElementById('platformFilter'), language: document.getElementById('languageFilter'),
  country: document.getElementById('countryFilter'), status: document.getElementById('statusFilter'),
  creative: document.getElementById('creativeFilter'),
};
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

  Object.entries(filterInputs).forEach(([key, input]) => input?.addEventListener('change', () => {
    state.filters[key] = input.value;
    applyFiltersAndRender(1);
  }));

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
  resultsFilters.style.display = 'none';
  loadingState.style.display = 'block';
  searchSubmitBtn.disabled = true;
  searchSubmitBtn.setAttribute('aria-busy', 'true');

  // Staged progress remains visible while the server validates and archives media.
  const steps = [
    { label: 'Understanding your product...', detail: 'Building strict brand and product search vectors.', delay: 0 },
    { label: 'Searching live Meta ads...', detail: 'Collecting current campaigns from the public Ads Library.', delay: 2200 },
    { label: 'Verifying relevance with AI...', detail: 'Removing unrelated brands, noise, and duplicate creatives.', delay: 9000 },
    { label: 'Extracting images and videos...', detail: 'Resolving every creative needed for this results page.', delay: 18000 },
    { label: 'Preparing seamless previews...', detail: 'Caching selected media for stable, fast playback.', delay: 30000 },
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
    resetResultFilters();
    populateResultFilters(state.rawRankedAds);

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
    resultsFilters.style.display = 'block';

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

function resetResultFilters() {
  state.filters = { platform: '', language: '', country: '', status: '', creative: '' };
  Object.values(filterInputs).forEach(input => { if (input) input.value = ''; });
}

function populateResultFilters(ads) {
  const values = {
    platform: new Set(), language: new Set(), country: new Set(),
  };
  for (const ad of ads || []) {
    (ad.stats?.platforms || []).forEach(value => values.platform.add(String(value)));
    (ad.stats?.languages || []).forEach(value => values.language.add(String(value)));
    (ad.stats?.countries || []).forEach(value => values.country.add(String(value)));
  }
  for (const [key, set] of Object.entries(values)) {
    const input = filterInputs[key];
    if (!input) continue;
    input.replaceChildren(new Option(`All ${key === 'country' ? 'countries' : `${key}s`}`, ''));
    [...set].sort().forEach(value => input.add(new Option(value, value)));
  }
}

async function preparePageMedia(ads, timeoutMs = 90000) {
  const candidates = (ads || []).filter(ad => {
    const media = state.resolvedMediaMap[String(ad.id)] || ad.media;
    return !media || media.status !== 'ready' || ['pending', 'fallback'].includes(media.storageStatus);
  }).slice(0, 10);
  if (!candidates.length) return;
  try {
    await Promise.race([
      Promise.all(candidates.map(ad => requestAdMedia(ad))),
      new Promise(resolve => setTimeout(resolve, timeoutMs)),
    ]);
  } catch (error) {
    console.warn('[Media] Page preparation completed with fallbacks:', error.message);
  }
}

/**
 * Direct Render & Pagination Function (Clean Pinterest Board)
 */
function applyFiltersAndRender(targetPage = 1) {
  state.currentPage = targetPage;
  const normal = value => String(value || '').trim().toLowerCase();
  const selected = state.filters;
  const items = (state.rawRankedAds || []).filter(ad => {
    const stats = ad.stats || {};
    const has = (values, selectedValue) => !selectedValue || (values || []).some(value => normal(value) === normal(selectedValue));
    const mediaType = normal(ad.media?.mediaType || ad.media?.creatives?.[0]?.mediaType);
    return has(stats.platforms, selected.platform)
      && has(stats.languages, selected.language)
      && has(stats.countries, selected.country)
      && (!selected.status || (selected.status === 'active') === Boolean(stats.isActive))
      && (!selected.creative || mediaType === selected.creative);
  });
  if (filterResultCount) {
    const totalUnique = (state.rawRankedAds || []).length;
    const source = state.sourceAdsFound || totalUnique;
    filterResultCount.textContent = `${items.length} of ${totalUnique} unique creatives · ${source} source ads`;
  }

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

    // Country Flag Mapper
    const countryFlagMap = {
      US: '🇺🇸 US', GB: '🇬🇧 UK', CA: '🇨🇦 CA', AU: '🇦🇺 AU', NZ: '🇳🇿 NZ',
      DE: '🇩🇪 DE', FR: '🇫🇷 FR', IT: '🇮🇹 IT', ES: '🇪🇸 ES', NL: '🇳🇱 NL',
      SE: '🇸🇪 SE', NO: '🇳🇴 NO', DK: '🇩🇰 DK', FI: '🇫🇮 FI', IE: '🇮🇪 IE',
      CH: '🇨🇭 CH', AT: '🇦🇹 AT', BE: '🇧🇪 BE', PL: '🇵🇱 PL', SG: '🇸🇬 SG',
      JP: '🇯🇵 JP', KR: '🇰🇷 KR', BR: '🇧🇷 BR', MX: '🇲🇽 MX'
    };

    // Format countries where ad is posted
    const rawCountries = (ad.stats?.countries || []).filter(c => c && typeof c === 'string' && c.length <= 3 && c.toUpperCase() !== 'EN');
    const formattedCountries = rawCountries.length > 0
      ? rawCountries.map(c => countryFlagMap[c.toUpperCase()] || c.toUpperCase()).join(', ')
      : '🇺🇸 US, 🇬🇧 UK, 🇨🇦 CA, 🇦🇺 AU';

    // Format platform chips from raw Meta data
    const rawPlatforms = (ad.stats?.platforms && ad.stats.platforms.length > 0)
      ? ad.stats.platforms
      : ['facebook', 'instagram'];

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
    const startDate = ad.stats?.startDate
      ? new Date(ad.stats.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '';

    // Format EU Reach (ONLY display when available and > 0)
    const rawEuReach = ad.stats?.euTotalReach || ad.stats?.euReach;
    const hasEuReach = rawEuReach && !isNaN(rawEuReach) && Number(rawEuReach) > 0;
    const euReachFormatted = hasEuReach
      ? (Number(rawEuReach) >= 1000 ? `${(Number(rawEuReach) / 1000).toFixed(1)}K` : String(rawEuReach))
      : null;

    const variantCount = (ad.variants && ad.variants.length > 0) ? ad.variants.length : (ad.variantCount || 1);
    const linkDesc = ad.copy?.description || '';

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

      <div class="card-destination-strip" id="card-dest-${ad.id}" onclick="event.stopPropagation(); window.openOutboundUrl('${ad.id}')" title="Visit landing page (opens in new tab)" role="button" tabindex="0">
        <span class="card-dest-domain" title="${ad.destinationUrl || ad.displayDomain || ''}">🌐 ${ad.displayDomain || 'Website'}</span>
        <span class="card-dest-cta">${ad.ctaText || 'Learn More'} ↗</span>
      </div>

      <div class="card-stats-strip">
        <div class="stat-item">
          <span class="stat-label">Duration</span>
          <span class="stat-value">
            ${ad.stats.flightDays} day${ad.stats.flightDays === 1 ? '' : 's'}
          </span>
        </div>
        ${euReachFormatted ? `
          <div class="stat-item" title="Official EU Verified Audience Reach returned by Meta">
            <span class="stat-label">EU Reach</span>
            <span class="stat-value">🇪🇺 ${euReachFormatted}</span>
          </div>
        ` : `
          <div class="stat-item">
            <span class="stat-label">Started</span>
            <span class="stat-value">${startDate || 'Recent'}</span>
          </div>
        `}
        <div class="stat-item" title="Countries where ad is actively posted">
          <span class="stat-label">Target Countries</span>
          <span class="stat-value" style="font-size: 0.76rem; font-weight: 600;">${formattedCountries}</span>
        </div>
      </div>

      <div class="card-platforms-row">
        <span class="meta-label">Platforms:</span>
        <div class="platform-chips-wrap">
          ${platformPillsHtml}
        </div>
      </div>

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

      <div class="card-copy-content">
        <!-- 1. Primary Text (Post Copy) -->
        <div class="copy-section copy-section-body" id="body-wrap-${ad.id}" style="${ad.copy.body ? '' : 'display:none;'}">
          <span class="copy-label-tag tag-primary">Primary Text</span>
          <p class="ad-body-text" id="body-text-${ad.id}">${ad.copy.body || ''}</p>
          ${ad.copy.body && ad.copy.body.length > 110 ? `<button type="button" class="show-more-btn" id="show-more-btn-${ad.id}" onclick="event.stopPropagation(); toggleCopy('${ad.id}')">Read more</button>` : ''}
        </div>

        <!-- 2. Headline / Title -->
        <div class="copy-section copy-section-headline" id="headline-wrap-${ad.id}" style="${ad.copy.headline ? '' : 'display:none;'}">
          <span class="copy-label-tag tag-headline">Headline</span>
          <h4 class="ad-headline" id="headline-${ad.id}">${ad.copy.headline || ''}</h4>
        </div>

        <!-- 3. Link Description -->
        <div class="copy-section copy-section-desc" id="desc-wrap-${ad.id}" style="${linkDesc ? '' : 'display:none;'}">
          <span class="copy-label-tag tag-desc">Description</span>
          <p class="ad-desc-snippet" id="desc-snippet-${ad.id}">${linkDesc || ''}</p>
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
const automaticRefreshes = new Set();
const creativeIndices = new Map();

function resetMediaSession() {
  mediaGeneration++;
  pendingSniffQueue.clear();
  clearTimeout(sniffDebounceTimer);
  cardObserver?.disconnect();
  adGrid.querySelectorAll('.card-media-box').forEach(box => AdMedia.dispose(box));
  state.resolvedMediaMap = {};
  automaticRefreshes.clear();
  creativeIndices.clear();
}

function currentMedia(ad) {
  const media = state.resolvedMediaMap[ad.id] || ad.media;
  return media?.schemaVersion === 2 ? media : null;
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
    onIndexChange: index => creativeIndices.set(String(ad.id), index),
    onRefresh: async manual => {
      const id = String(ad.id);
      if (generation !== mediaGeneration || (!manual && automaticRefreshes.has(id))) return null;
      automaticRefreshes.add(id);
      const media = await requestAdMedia(ad, true);
      return generation === mediaGeneration ? media : null;
    },
  });
  if (box.id === 'modalMediaBox' && !currentMedia(ad)) {
    requestAdMedia(ad).then(() => {
      if (generation === mediaGeneration && box.isConnected
          && String(window._currentModalAd?.id) === String(ad.id)) renderAdMedia(ad, box);
    });
  }
}

async function requestAdMedia(ad, forceRefresh = false) {
  const generation = mediaGeneration;
  const id = String(ad.id);
  const key = `${generation}:${id}`;
  if (mediaRequests.has(key)) return mediaRequests.get(key);
  const request = (async () => {
    let media;
    try {
      const response = await fetch('/api/sniff-page', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ads: [{ id, adSnapshotUrl: ad.adSnapshotUrl || null }], forceRefresh }),
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
      // Keep a surviving poster on refresh failure; the viewer displays the failure separately.
      if (media.status === 'ready' || !currentMedia(ad)) state.resolvedMediaMap[id] = media;
      if (media.destinationUrl) {
        ad.destinationUrl = media.destinationUrl;
        try { ad.displayDomain = new URL(media.destinationUrl).hostname.replace(/^www\./, ''); } catch {}
      }
      if (media.ctaText) ad.ctaText = media.ctaText;
      const strip = document.getElementById(`card-dest-${id}`);
      if (strip) {
        const domain = strip.querySelector('.card-dest-domain');
        const cta = strip.querySelector('.card-dest-cta');
        if (domain) { domain.textContent = `🌐 ${ad.displayDomain || 'Website'}`; domain.title = ad.destinationUrl || ''; }
        if (cta) cta.textContent = `${ad.ctaText || 'Learn More'} ↗`;
      }
    }
    return media;
  })();
  mediaRequests.set(key, request);
  try { return await request; } finally { mediaRequests.delete(key); }
}

function observeCardsForSniffing() {
  cardObserver?.disconnect();
  const queue = ad => {
    if (!currentMedia(ad)) pendingSniffQueue.add(String(ad.id));
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

  // Update primary body text
  const bodyEl = document.getElementById(`body-text-${adId}`);
  const bodyWrap = document.getElementById(`body-wrap-${adId}`);
  const moreBtn = document.getElementById(`show-more-btn-${adId}`);
  if (bodyEl) {
    bodyEl.textContent = v.body || '';
    bodyEl.classList.remove('expanded');
  }
  if (bodyWrap) bodyWrap.style.display = v.body ? 'flex' : 'none';
  if (moreBtn) {
    moreBtn.textContent = 'Read more';
    moreBtn.style.display = (v.body && v.body.length > 110) ? 'inline-block' : 'none';
  }

  // Update headline
  const headlineEl = document.getElementById(`headline-${adId}`);
  const headlineWrap = document.getElementById(`headline-wrap-${adId}`);
  if (headlineEl) headlineEl.textContent = v.headline || '';
  if (headlineWrap) headlineWrap.style.display = v.headline ? 'flex' : 'none';

  // Update description snippet
  const descEl = document.getElementById(`desc-snippet-${adId}`);
  const descWrap = document.getElementById(`desc-wrap-${adId}`);
  if (descEl) descEl.textContent = v.description || '';
  if (descWrap) descWrap.style.display = v.description ? 'flex' : 'none';

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
  const text = [v.headline, v.body].filter(Boolean).join('\n\n');
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

async function changePage(newPage) {
  if (newPage < 1 || newPage > state.totalPages || newPage === state.currentPage) return;
  const start = (newPage - 1) * state.pageSize;
  const pageAds = state.rawRankedAds.slice(start, start + state.pageSize);
  adGrid.style.display = 'none';
  paginationNav.style.display = 'none';
  loadingState.style.display = 'block';
  loadingState.innerHTML = `<div class="spinner"></div><h3>Preparing page ${newPage}...</h3>
    <p>Stabilizing image and video previews before they appear.</p>`;
  await preparePageMedia(pageAds, 90000);
  loadingState.style.display = 'none';
  adGrid.style.display = 'grid';
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

  const flightDays = ad.stats?.flightDays || 1;
  const statusStr = ad.stats?.isActive ? `Active for ${flightDays} days` : `Ran for ${flightDays} days`;
  if (metaSubEl) metaSubEl.textContent = `Meta Ad ID: ${ad.id} • ${statusStr}`;

  window._currentModalAd = ad;
  window._currentVariantIdx = 0;

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
          <div class="meta-stats-grid">
            <div class="meta-stat-cell">
              <span class="meta-stat-label">Flight Duration</span>
              <span class="meta-stat-val">${ad.stats?.flightDays || 1} Days Active</span>
            </div>
            ${euReachText ? `
              <div class="meta-stat-cell">
                <span class="meta-stat-label">EU Reach</span>
                <span class="meta-stat-val" style="color: #1d4ed8;">${euReachText}</span>
              </div>
            ` : `
              <div class="meta-stat-cell">
                <span class="meta-stat-label">Regions</span>
                <span class="meta-stat-val">${(ad.stats?.countries || []).join(', ') || 'Global'}</span>
              </div>
            `}
            <div class="meta-stat-cell">
              <span class="meta-stat-label">Scale Tier</span>
              <span class="meta-stat-val">${ad.stats?.scaleTier ? ad.stats.scaleTier.split('(')[0].trim() : 'Active'}</span>
            </div>
            <div class="meta-stat-cell">
              <span class="meta-stat-label">Launch Date</span>
              <span class="meta-stat-val">${currentVariant.startDate || ad.stats?.startDate || 'Recent'}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Column: Interactive Variant Explorer & Copy Inspector -->
      <div class="modal-right-col">
        ${variantTabsHtml}

        <!-- Headline Box -->
        ${currentVariant.headline ? `
          <div class="modal-copy-section">
            <div class="copy-box-header">
              <span class="modal-section-label">Ad Headline</span>
              <button type="button" class="copy-action-btn" onclick="copyToClipboard('${currentVariant.headline.replace(/'/g, "\\'")}', this)">📋 Copy</button>
            </div>
            <h4 class="modal-headline">${currentVariant.headline}</h4>
          </div>
        ` : ''}

        <!-- Primary Body Copy Box -->
        <div class="modal-copy-section">
          <div class="copy-box-header">
            <span class="modal-section-label">Primary Ad Copy</span>
            <button type="button" class="copy-action-btn" onclick="copyToClipboard('${(currentVariant.body || '').replace(/'/g, "\\'").replace(/\n/g, '\\n')}', this)">📋 Copy Body</button>
          </div>
          <div class="modal-body-text">${currentVariant.body || 'No text copy'}</div>
        </div>

        <!-- Secondary Link Description Box -->
        ${currentVariant.description ? `
          <div class="modal-copy-section">
            <div class="copy-box-header">
              <span class="modal-section-label">Link Subtitle / Description</span>
              <button type="button" class="copy-action-btn" onclick="copyToClipboard('${currentVariant.description.replace(/'/g, "\\'")}', this)">📋 Copy</button>
            </div>
            <p style="font-size: 0.8rem; color: var(--text-secondary); font-style: italic;">${currentVariant.description}</p>
          </div>
        ` : ''}

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
