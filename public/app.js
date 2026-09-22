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

// Application State
const state = {
  currentInput: '',
  currentPage: 1,
  pageSize: 10,
  totalPages: 1,
  rawRankedAds: [],       // All ads returned by server
  currentProfile: null,
  currentFilter: 'ALL',   // 'ALL' | 'BRAND_AFFILIATE' | 'COMPETITOR'
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

// Quick Search from Suggestion Chips
window.executeQuickSearch = function (query) {
  if (!query) return;
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
    if (val) {
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
  state.currentInput = targetInput;
  state.currentPage = page;

  // UI state transitions — hide stale content from previous search
  emptyState.style.display = 'none';
  adGrid.style.display = 'none';
  paginationNav.style.display = 'none';
  loadingState.style.display = 'block';
  searchSubmitBtn.disabled = true;

  // Unified 4-stage loading progress matching the backend pipeline
  const steps = [
    { label: 'Analyzing your query with AI...', delay: 0 },
    { label: 'Searching Meta Ad Library...', delay: 2000 },
    { label: 'AI ranking & filtering results...', delay: 6000 },
    { label: 'Loading ad previews...', delay: 12000 },
  ];

  loadingState.innerHTML = `
    <div class="spinner"></div>
    <h3 id="loadingTitle">${steps[0].label}</h3>
    <p id="loadingSubhead">This may take a moment.</p>
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

  // Animate through steps on timers
  const stepTimers = [];
  const searchStartTime = Date.now();
  const elapsedInterval = setInterval(() => {
    const el = document.getElementById('loadingElapsed');
    if (el) el.textContent = `${Math.floor((Date.now() - searchStartTime) / 1000)}s`;
  }, 1000);

  steps.forEach((s, i) => {
    if (i === 0) return;
    stepTimers.push(setTimeout(() => {
      // Mark previous as done
      for (let j = 0; j < i; j++) {
        const prev = document.getElementById(`loadStep${j}`);
        if (prev) {
          prev.classList.remove('active');
          prev.classList.add('done');
          prev.querySelector('.step-icon').textContent = '✓';
        }
      }
      // Mark current as active
      const curr = document.getElementById(`loadStep${i}`);
      if (curr) {
        curr.classList.add('active');
        curr.querySelector('.step-icon').textContent = '●';
      }
      const title = document.getElementById('loadingTitle');
      if (title) title.textContent = s.label;
    }, s.delay));
  });

  try {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: targetInput,
        countries: ['US', 'GB', 'CA', 'AU'],
        status: 'ALL',
        mediaType: 'ALL',
        page: 1,
        pageSize: 100,
        useCache: true,
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error);

    state.currentProfile = data.queryProfile;
    state.rawRankedAds = data.paginated.items;

    loadingState.style.display = 'none';
    adGrid.style.display = 'grid';

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
    searchSubmitBtn.disabled = false;
  }
}

/**
 * Direct Render & Pagination Function (Clean Pinterest Board)
 */
function applyFiltersAndRender(targetPage = 1) {
  state.currentPage = targetPage;
  const items = [...state.rawRankedAds];

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

    const cachedMedia = state.resolvedMediaMap[ad.id] || ad.media;
    const mediaHtml = buildMediaHtml(ad.id, cachedMedia);

    const statusClass = ad.stats.isActive ? 'active' : 'inactive';
    const statusText = ad.stats.isActive ? 'Active' : 'Inactive';
    const rel = ad.ranking?.relationship || ad.ranking?.relevanceType;
    let relBadge = '';
    if (rel === 'OFFICIAL_BRAND' || rel === 'DIRECT_BRAND') {
      relBadge = `<span class="relevance-tag official-tag">Official Brand</span>`;
    } else if (rel === 'REVIEW_EDITORIAL') {
      relBadge = `<span class="relevance-tag review-tag">Review / Editorial</span>`;
    } else if (rel === 'AFFILIATE_PARTNER' || rel === 'BRAND_AFFILIATE') {
      relBadge = `<span class="relevance-tag affiliate-tag">Affiliate / Partner</span>`;
    } else if (rel && rel !== 'UNRELATED') {
      relBadge = `<span class="relevance-tag affiliate-tag">Product Ad</span>`;
    }

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

    // Impression Tier Badge (High Impression vs Low Impression)
    const impTier = (ad.stats?.impressionTier || ad.stats?.scaleTier || '').toLowerCase();
    let impressionBadge = '';
    if (impTier.includes('high') || (ad.stats?.euTotalReach && ad.stats.euTotalReach >= 10000) || ad.stats?.flightDays >= 21) {
      impressionBadge = `<span class="impression-badge high-imp" title="High Impression / Scaled Winning Ad">🔥 High Impression</span>`;
    } else if (impTier.includes('low') || ad.stats?.flightDays <= 5) {
      impressionBadge = `<span class="impression-badge low-imp" title="Low impression testing ad">📉 Low Impression</span>`;
    } else {
      impressionBadge = `<span class="impression-badge mid-imp" title="Active scaling ad">⚡ Moderate Scale</span>`;
    }

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
          ${relBadge}
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          ${impressionBadge}
          <div class="card-status-badge ${statusClass}">
            <span class="status-dot"></span>
            ${statusText}
          </div>
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

      <!-- In-Card Variant Carousel Controller (Flips directly on the grid — no modal) -->
      <div class="card-variant-carousel-bar">
        ${variantCount > 1 ? `
          <div class="variant-carousel-nav">
            <button type="button" class="variant-nav-arrow" onclick="event.stopPropagation(); flipCardVariant('${ad.id}', -1)" title="Previous copy variant" aria-label="Previous variant">‹</button>
            <span class="variant-step-counter" id="var-counter-${ad.id}">
              Variant <b>1</b> of ${variantCount}
            </span>
            <button type="button" class="variant-nav-arrow" onclick="event.stopPropagation(); flipCardVariant('${ad.id}', 1)" title="Next copy variant" aria-label="Next variant">›</button>
          </div>
        ` : `
          <span class="variant-single-label">Tested Copy</span>
        `}
        <button type="button" class="card-copy-btn" id="copy-btn-${ad.id}" onclick="event.stopPropagation(); copyActiveVariantCopy('${ad.id}', this)" title="Copy headline & body to clipboard">
          📋 Copy Copy
        </button>
      </div>

      <div class="card-copy-content">
        <h4 class="ad-headline" id="headline-${ad.id}" style="${ad.copy.headline ? '' : 'display:none;'}">${ad.copy.headline || ''}</h4>
        <p class="ad-body-text" id="body-text-${ad.id}">${ad.copy.body || ''}</p>
        <p class="ad-desc-snippet" id="desc-snippet-${ad.id}" style="${linkDesc ? '' : 'display:none;'}">${linkDesc || ''}</p>
        ${ad.copy.body.length > 110 ? `<button class="show-more-btn" onclick="event.stopPropagation(); toggleCopy('${ad.id}')">Read more</button>` : ''}
      </div>
    `;

    // Card hover plays video
    card.addEventListener('mouseenter', () => {
      const v = card.querySelector('video');
      if (v && v.paused) v.play().catch(() => {});
    });

    adGrid.appendChild(card);
  });

  setupVideoAutoPlay();
}

/**
 * Autoplay visible videos on scroll (Pinterest / Instagram feed style)
 */
let videoObserver = null;
function setupVideoAutoPlay() {
  if (!window.IntersectionObserver) return;
  if (videoObserver) {
    videoObserver.disconnect();
  }

  videoObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const video = entry.target;
      if (entry.isIntersecting && entry.intersectionRatio >= 0.3) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });
  }, { threshold: [0, 0.3, 0.7] });

  document.querySelectorAll('.ad-card video').forEach((v) => {
    videoObserver.observe(v);
  });
}

/**
 * Build Media Container HTML (Video / Image / Shimmer)
 */
function buildMediaHtml(adId, media, isSniffed = false) {
  if (!media || (!media.thumbnailUrl && !media.videoUrl)) {
    if (isSniffed) {
      return `
        <div class="shimmer-placeholder static-preview">
          <span class="shimmer-icon">✨</span>
          <span>Ad Creative</span>
        </div>
      `;
    }
    return `
      <div class="shimmer-placeholder">
        <span class="shimmer-icon">🎬</span>
        <span>Loading creative...</span>
      </div>
    `;
  }

  if (media.videoUrl) {
    const posterAttr = media.thumbnailUrl ? `poster="${media.thumbnailUrl}"` : '';
    return `
      <span class="video-badge">▶ VIDEO</span>
      <video 
        id="video-${adId}"
        src="${media.videoUrl}" 
        ${posterAttr}
        referrerpolicy="no-referrer"
        playsinline
        webkit-playsinline
        muted
        loop
        preload="metadata"
        onclick="event.stopPropagation(); window.toggleVideoPlay('${adId}')"
        onerror="if (this.getAttribute('poster')) { this.outerHTML = '<img src=\\'' + this.getAttribute('poster') + '\\' alt=\\'Meta Ad Creative\\' referrerpolicy=\\'no-referrer\\' loading=\\'lazy\\' />'; }"
      ></video>
      <div class="video-play-overlay" id="play-overlay-${adId}" onclick="event.stopPropagation(); window.toggleVideoPlay('${adId}')" role="button" aria-label="Play video">
        <span class="play-overlay-icon">▶</span>
      </div>
      <button class="sound-toggle-btn" id="sound-btn-${adId}" onclick="event.stopPropagation(); window.toggleAudio('${adId}')" title="Unmute Video Audio" aria-label="Toggle audio">
        🔇
      </button>
    `;
  }

  if (media.thumbnailUrl) {
    return `
      <img 
        src="${media.thumbnailUrl}" 
        alt="Meta Ad Creative" 
        referrerpolicy="no-referrer" 
        loading="lazy"
        onerror="this.parentElement.innerHTML='<div class=\\'shimmer-placeholder static-preview\\'><span class=\\'shimmer-icon\\'>✨</span><span>Ad Creative</span></div>'"
      />
    `;
  }

  return `
    <div class="shimmer-placeholder static-preview">
      <span class="shimmer-icon">✨</span>
      <span>Ad Creative</span>
    </div>
  `;
}

/**
 * Viewport-Based Lazy Media Sniffer with Visual Deduplication (Zero-Cost Anti-Scraping)
 * Only sniffs media when a card enters or approaches the viewport (rootMargin: 250px).
 */
let cardObserver = null;
const pendingSniffQueue = new Set();
let sniffDebounceTimer = null;

function observeCardsForSniffing() {
  if (!window.IntersectionObserver) {
    // Fallback for browsers without IntersectionObserver
    const pageAds = state.currentAds || [];
    executeSniffBatch(pageAds.map(a => a.id));
    return;
  }

  if (cardObserver) {
    cardObserver.disconnect();
  }

  cardObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const adId = entry.target.getAttribute('data-ad-id');
          if (adId && !state.resolvedMediaMap[adId]) {
            pendingSniffQueue.add(adId);
            scheduleFlushSniffQueue();
          }
          // Once queued, unobserve this card
          cardObserver.unobserve(entry.target);
        }
      });
    },
    {
      rootMargin: '250px 0px', // Prefetch 250px before entering viewport for instantaneous display
      threshold: 0.05,
    }
  );

  document.querySelectorAll('.ad-card').forEach((card) => {
    const adId = card.getAttribute('data-ad-id');
    const ad = (state.currentAds || []).find((a) => String(a.id) === String(adId));
    const hasMedia =
      state.resolvedMediaMap[adId] ||
      (ad && ad.media && (ad.media.thumbnailUrl || ad.media.videoUrl));

    if (!hasMedia) {
      cardObserver.observe(card);
    }
  });
}

function scheduleFlushSniffQueue() {
  if (sniffDebounceTimer) clearTimeout(sniffDebounceTimer);
  sniffDebounceTimer = setTimeout(async () => {
    if (pendingSniffQueue.size === 0) return;
    const batchIds = Array.from(pendingSniffQueue).slice(0, 4);
    batchIds.forEach((id) => pendingSniffQueue.delete(id));

    await executeSniffBatch(batchIds);

    if (pendingSniffQueue.size > 0) {
      scheduleFlushSniffQueue();
    }
  }, 100);
}

async function executeSniffBatch(adIds = []) {
  const needsSniffing = adIds.filter(
    (id) => !state.resolvedMediaMap[id]
  );

  if (needsSniffing.length === 0) return;

  try {
    const payload = needsSniffing.map((id) => {
      const ad = (state.currentAds || []).find((a) => String(a.id) === String(id));
      return { id, adSnapshotUrl: ad?.adSnapshotUrl || null };
    });

    const res = await fetch('/api/sniff-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ads: payload }),
    });

    const data = await res.json();
    if (data.mediaMap) {
      Object.assign(state.resolvedMediaMap, data.mediaMap);

      // Visual Deduplication: Ensure no two cards from the same advertiser display the exact same creative
      const seenMediaKeys = new Map();

      // Index media already present on active page
      (state.currentAds || []).forEach((a) => {
        const m = state.resolvedMediaMap[a.id] || a.media;
        const url = m && (m.videoUrl || m.thumbnailUrl);
        if (url) {
          const key = `${(a.pageName || '').toLowerCase()}:::${url}`;
          if (!seenMediaKeys.has(key)) {
            seenMediaKeys.set(key, a.id);
          }
        }
      });

      // Patch media & collapse duplicate creative cards
      for (const [adId, media] of Object.entries(data.mediaMap)) {
        const mediaUrl = media.videoUrl || media.thumbnailUrl;
        const ad = (state.currentAds || []).find((a) => String(a.id) === String(adId));
        const key = ad && mediaUrl ? `${(ad.pageName || '').toLowerCase()}:::${mediaUrl}` : null;

        if (key && seenMediaKeys.has(key) && String(seenMediaKeys.get(key)) !== String(adId)) {
          // Collapse duplicate visual card into primary card
          const primaryId = seenMediaKeys.get(key);
          const duplicateCard = document.getElementById(`ad-card-${adId}`);
          if (duplicateCard) {
            duplicateCard.remove();
          }
          const primaryCard = document.getElementById(`ad-card-${primaryId}`);
          if (primaryCard) {
            const statVal = primaryCard.querySelectorAll('.card-stats-strip .stat-value')[2];
            if (statVal) {
              const currentText = statVal.textContent;
              const match = currentText.match(/\((\d+)\s*ads\)/i);
              const count = match ? parseInt(match[1], 10) + 1 : 2;
              statVal.innerHTML = `${statVal.innerHTML.split('(')[0].trim()} (${count} ads)`;
            }
          }
          continue;
        }

        if (key && !seenMediaKeys.has(key)) {
          seenMediaKeys.set(key, adId);
        }

        const box = document.getElementById(`media-box-${adId}`);
        if (box) {
          box.innerHTML = buildMediaHtml(adId, media, true);
        }

        // Update destination and CTA data on the card
        if (ad) {
          if (media.destinationUrl) {
            ad.destinationUrl = media.destinationUrl;
            try {
              ad.displayDomain = new URL(media.destinationUrl).hostname.replace(/^www\./, '');
            } catch (e) {}
          }
          if (media.ctaText) {
            ad.ctaText = media.ctaText;
          }

          const destStrip = document.getElementById(`card-dest-${adId}`);
          if (destStrip) {
            destStrip.innerHTML = `
              <span class="card-dest-domain" title="${ad.destinationUrl || ad.displayDomain || ''}">🌐 ${ad.displayDomain || 'Website'}</span>
              <span class="card-dest-cta">${ad.ctaText || 'Learn More'} →</span>
            `;
          }


        }
      }

      setupVideoAutoPlay();
      fetchHealth();
    }
  } catch (e) {
    console.warn('[Sniffer] Batch sniffing notice:', e.message);
  }
}

// Backward compatibility alias
function sniffMediaForCurrentPage(ads) {
  observeCardsForSniffing();
}

/**
 * Toggle Video Play / Pause with Visual Feedback
 */
window.toggleVideoPlay = function (adId) {
  const video = document.getElementById(`video-${adId}`);
  const overlay = document.getElementById(`play-overlay-${adId}`);
  if (video) {
    if (video.paused) {
      video.play().catch(() => {});
      if (overlay) overlay.style.display = 'none';
    } else {
      video.pause();
      if (overlay) overlay.style.display = 'flex';
    }
  }
};

/**
 * Audio Toggle Helper with Exclusive Sound (Only one video sounds at a time)
 */
window.toggleAudio = function (adId) {
  const video = document.getElementById(`video-${adId}`);
  if (video) {
    if (video.muted) {
      // Mute all other playing videos
      document.querySelectorAll('.ad-card video').forEach((v) => {
        if (v !== video) {
          v.muted = true;
          const otherBtn = v.parentElement?.querySelector('.sound-toggle-btn');
          if (otherBtn) {
            otherBtn.textContent = '🔇';
            otherBtn.title = 'Unmute Video Audio';
            otherBtn.classList.remove('unmuted');
          }
        }
      });
    }

    video.muted = !video.muted;
    const btn = document.getElementById(`sound-btn-${adId}`);
    if (btn) {
      btn.textContent = video.muted ? '🔇' : '🔊';
      btn.title = video.muted ? 'Unmute Video Audio' : 'Mute Video Audio';
      if (!video.muted) btn.classList.add('unmuted');
      else btn.classList.remove('unmuted');
    }
    if (!video.muted && video.paused) {
      video.play().catch(() => {});
      const overlay = document.getElementById(`play-overlay-${adId}`);
      if (overlay) overlay.style.display = 'none';
    }
  }
};

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

  // Update headline with subtle fade
  const headlineEl = document.getElementById(`headline-${adId}`);
  if (headlineEl) {
    headlineEl.textContent = v.headline || '';
    headlineEl.style.display = v.headline ? 'block' : 'none';
  }

  // Update body text
  const bodyEl = document.getElementById(`body-text-${adId}`);
  if (bodyEl) {
    bodyEl.textContent = v.body || '';
  }

  // Update description snippet
  const descEl = document.getElementById(`desc-snippet-${adId}`);
  if (descEl) {
    descEl.textContent = v.description || '';
    descEl.style.display = v.description ? 'block' : 'none';
  }

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
 * Toggle Body Copy Read More
 */
window.toggleCopy = function (adId) {
  const p = document.getElementById(`body-text-${adId}`);
  const btn = p.nextElementSibling;
  if (p.style.webkitLineClamp === 'unset') {
    p.style.webkitLineClamp = '3';
    btn.textContent = 'Read Full Copy';
  } else {
    p.style.webkitLineClamp = 'unset';
    btn.textContent = 'Show Less';
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

  const rel = ad.ranking?.relationship || ad.ranking?.relevanceType;
  let relBadge = '';
  if (rel === 'OFFICIAL_BRAND' || rel === 'DIRECT_BRAND') {
    relBadge = `<span class="relevance-tag official-tag">Official Brand</span>`;
  } else if (rel === 'REVIEW_EDITORIAL') {
    relBadge = `<span class="relevance-tag review-tag">Review / Editorial</span>`;
  } else if (rel === 'AFFILIATE_PARTNER' || rel === 'BRAND_AFFILIATE') {
    relBadge = `<span class="relevance-tag affiliate-tag">Affiliate / Partner</span>`;
  } else {
    relBadge = `<span class="relevance-tag affiliate-tag">Product Ad</span>`;
  }
  if (badgeEl) badgeEl.innerHTML = relBadge;

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
  const v = modal ? modal.querySelector('video') : null;
  if (v) v.pause();
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
  const cachedMedia = state.resolvedMediaMap[ad.id] || ad.media;

  // Media HTML for Modal Left Col
  let mediaHtml = '';
  if (cachedMedia && cachedMedia.videoUrl) {
    mediaHtml = `
      <div class="modal-media-wrap">
        <video src="${cachedMedia.videoUrl}" poster="${cachedMedia.thumbnailUrl || ''}" controls playsinline autoplay loop></video>
      </div>
    `;
  } else if (cachedMedia && cachedMedia.thumbnailUrl) {
    mediaHtml = `
      <div class="modal-media-wrap">
        <img src="${cachedMedia.thumbnailUrl}" alt="${ad.pageName} Ad Creative" loading="lazy" />
      </div>
    `;
  } else {
    mediaHtml = `
      <div class="modal-media-wrap" style="padding: 40px; text-align: center; color: var(--text-muted);">
        <div style="font-size: 2.5rem; margin-bottom: 8px;">🎬</div>
        <p style="font-size: 0.85rem;">Media preview loading or static creative</p>
      </div>
    `;
  }

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
}
