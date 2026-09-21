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


const pdpDossierCard = document.getElementById('pdpDossierCard');
const dossierBrandName = document.getElementById('dossierBrandName');
const dossierDomain = document.getElementById('dossierDomain');
const dossierCategory = document.getElementById('dossierCategory');
const dossierDesc = document.getElementById('dossierDesc');
const dossierVectorsList = document.getElementById('dossierVectorsList');

const emptyState = document.getElementById('emptyState');
const loadingState = document.getElementById('loadingState');
const loadingTitle = document.getElementById('loadingTitle');
const loadingSubhead = document.getElementById('loadingSubhead');

const adGrid = document.getElementById('adGrid');
const paginationNav = document.getElementById('paginationNav');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageNumbersList = document.getElementById('pageNumbersList');

// Modal Elements
const adModal = document.getElementById('adModal');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalBrandAvatar = document.getElementById('modalBrandAvatar');
const modalPageName = document.getElementById('modalPageName');
const modalVerifiedBadge = document.getElementById('modalVerifiedBadge');
const modalAdId = document.getElementById('modalAdId');
const modalMediaWrap = document.getElementById('modalMediaWrap');
const modalMediaActions = document.getElementById('modalMediaActions');
const modalStatsRow = document.getElementById('modalStatsRow');
const modalHeadline = document.getElementById('modalHeadline');
const modalBodyText = document.getElementById('modalBodyText');
const modalHookPill = document.getElementById('modalHookPill');
const copyClipboardBtn = document.getElementById('copyClipboardBtn');
const modalLibraryLink = document.getElementById('modalLibraryLink');

// Destination & Action Elements
const destinationIntelCard = document.getElementById('destinationIntelCard');
const modalDestUrlText = document.getElementById('modalDestUrlText');
const modalVisitDestBtn = document.getElementById('modalVisitDestBtn');
const modalVisitDestBtnText = document.getElementById('modalVisitDestBtnText');
const modalCopyDestBtn = document.getElementById('modalCopyDestBtn');
const modalDestStatusPill = document.getElementById('modalDestStatusPill');

// Initialize Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  fetchHealth();

  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = searchInput.value.trim();
    if (val) executeSearch(val, 1);
  });

  // Pagination navigation
  prevPageBtn.addEventListener('click', () => {
    if (state.currentPage > 1) changePage(state.currentPage - 1);
  });

  nextPageBtn.addEventListener('click', () => {
    if (state.currentPage < state.totalPages) changePage(state.currentPage + 1);
  });

  // Modal interactions
  modalCloseBtn.addEventListener('click', closeModal);
  adModal.addEventListener('click', (e) => {
    if (e.target === adModal) closeModal();
  });

  copyClipboardBtn.addEventListener('click', () => {
    const headline = (modalHeadline && modalHeadline.style.display !== 'none') ? modalHeadline.textContent.trim() : '';
    const body = modalBodyText ? modalBodyText.textContent.trim() : '';
    const text = [headline, body].filter(Boolean).join('\n\n');
    navigator.clipboard.writeText(text).then(() => {
      copyClipboardBtn.textContent = '✅ Copied!';
      setTimeout(() => { copyClipboardBtn.textContent = '📋 Copy Text'; }, 2000);
    });
  });
});

async function fetchHealth() {
  try {
    await fetch('/api/health');
  } catch (e) {}
}

/**
 * Execute Search Pipeline against Backend
 */
async function executeSearch(targetInput, page = 1) {
  state.currentInput = targetInput;
  state.currentPage = page;

  state.searchMode = state.searchMode || 'auto';

  // UI state transitions — hide stale content from previous search
  emptyState.style.display = 'none';
  adGrid.style.display = 'none';
  paginationNav.style.display = 'none';
  pdpDossierCard.style.display = 'none';
  loadingState.style.display = 'block';
  searchSubmitBtn.disabled = true;

  const isUrl = /^https?:\/\//i.test(targetInput) || targetInput.includes('.com') || targetInput.includes('.io') || targetInput.includes('.co');

  // Build rich loading progress UI
  const steps = isUrl
    ? [
        { label: 'Reading website...', delay: 0 },
        { label: 'Identifying brand & products...', delay: 3000 },
        { label: 'Searching Meta Ad Library...', delay: 7000 },
        { label: 'Ranking competitor ads...', delay: 12000 },
        { label: 'Loading ad previews...', delay: 18000 },
      ]
    : [
        { label: 'Searching Meta Ad Library...', delay: 0 },
        { label: 'Finding active campaigns...', delay: 3000 },
        { label: 'Ranking results...', delay: 8000 },
        { label: 'Loading ad previews...', delay: 14000 },
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
        searchType: state.searchMode || 'auto',
        countries: ['US', 'GB', 'CA', 'AU'],
        status: 'ALL', // fetch all so client-side filters can toggle instantaneously
        mediaType: 'ALL',
        page: 1,
        pageSize: 100, // retrieve full pool for client-side filtering and instant navigation
        useCache: true,
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error);

    state.currentProfile = data.profile;
    state.rawRankedAds = data.paginated.items;

    // Render PDP Overview if available
    renderProfileDossier(data.profile);

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
 * Render Profile Dossier Card
 */
function renderProfileDossier(profile) {
  if (!profile) {
    pdpDossierCard.style.display = 'none';
    return;
  }

  dossierBrandName.textContent = profile.brandName;
  dossierDomain.textContent = profile.domain ? `(${profile.domain})` : '';
  dossierCategory.textContent = profile.category;
  dossierDesc.textContent = profile.description || (profile.coreProduct ? `Key product: ${profile.coreProduct}.` : '');

  dossierVectorsList.innerHTML = '';
  (profile.suggestedVectors || []).forEach((vec) => {
    const pill = document.createElement('button');
    pill.className = 'vector-pill clickable';
    pill.textContent = vec.query;
    pill.title = `Search ads for "${vec.query}"`;
    pill.addEventListener('click', () => {
      searchInput.value = vec.query;
      executeSearch(vec.query, 1);
    });
    dossierVectorsList.appendChild(pill);
  });

  pdpDossierCard.style.display = 'block';
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
        <p>Try searching for a broader product term, a popular brand name, or a direct website domain.</p>
        <div class="empty-suggestions">
          <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Popular Searches:</span>
          <div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;">
            <button type="button" class="suggestion-chip" onclick="searchInput.value='Derila'; executeSearch('Derila', 1);">Derila</button>
            <button type="button" class="suggestion-chip" onclick="searchInput.value='NordVPN'; executeSearch('NordVPN', 1);">NordVPN</button>
            <button type="button" class="suggestion-chip" onclick="searchInput.value='Ridge Wallet'; executeSearch('Ridge Wallet', 1);">Ridge Wallet</button>
            <button type="button" class="suggestion-chip" onclick="searchInput.value='Ergonomic Pillow'; executeSearch('Ergonomic Pillow', 1);">Ergonomic Pillow</button>
            <button type="button" class="suggestion-chip" onclick="searchInput.value='Running Shoes'; executeSearch('Running Shoes', 1);">Running Shoes</button>
          </div>
        </div>
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
    const statusText = ad.stats.isActive ? 'Active' : 'Ended';
    const isCompetitor = ad.ranking?.relationship === 'COMPETITOR' || ad.ranking?.relevanceType === 'COMPETITOR';
    let relBadge = '';
    if (isCompetitor) {
      relBadge = `<span class="relevance-tag comp-tag">Competitor</span>`;
    }

    const angleText = ad.aiAnalysis?.creativeAngle || ad.copy?.primaryHook || 'Direct-Response';

    card.innerHTML = `
      <div class="card-header">
        <div class="advertiser-info">
          <span class="advertiser-name" title="${ad.pageName}">${ad.pageName}</span>
          ${relBadge}
        </div>
        <div class="card-status-badge ${statusClass}">
          <span class="status-dot"></span>
          ${statusText}
        </div>
      </div>

      <div class="card-media-box" id="media-box-${ad.id}">
        ${mediaHtml}
      </div>

      <div class="card-destination-strip" id="card-dest-${ad.id}">
        <span class="card-dest-domain" title="${ad.destinationUrl || ad.displayDomain || ''}">🌐 ${ad.displayDomain || 'Website'}</span>
        <span class="card-dest-cta">${ad.ctaText || 'Learn More'} →</span>
      </div>

      <div class="card-stats-strip">
        <div class="stat-item">
          <span class="stat-label">Duration</span>
          <span class="stat-value">
            ${ad.stats.flightDays} day${ad.stats.flightDays === 1 ? '' : 's'}
          </span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Regions</span>
          <span class="stat-value">
            ${(ad.stats.countries || []).join(', ') || 'Global'}
          </span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Reach</span>
          <span class="stat-value">
            ${ad.stats.scaleTier.includes('High') ? 'Top Performer' : (ad.stats.scaleTier.includes('Mid') ? 'Active Run' : 'Recent')}${ad.variantCount > 1 ? ` (${ad.variantCount} ads)` : ''}
          </span>
        </div>
      </div>

      <div class="card-copy-content">
        <span class="hook-archetype-pill">${angleText}</span>
        ${ad.copy.headline ? `<h4 class="ad-headline">${ad.copy.headline}</h4>` : ''}
        <p class="ad-body-text" id="body-text-${ad.id}">${ad.copy.body}</p>
        ${ad.copy.body.length > 110 ? `<button class="show-more-btn" onclick="toggleCopy('${ad.id}')">Read more</button>` : ''}
      </div>

      <div class="card-footer">
        <button class="view-ad-btn" onclick="openModalById('${ad.id}')">View Details</button>
      </div>
    `;

    // Card hover plays video
    card.addEventListener('mouseenter', () => {
      const v = card.querySelector('video');
      if (v && v.paused) v.play().catch(() => {});
    });

    // Clicking media opens the inspection modal
    card.querySelector('.card-media-box').addEventListener('click', () => openModal(ad));

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
        muted
        loop
        preload="auto"
        onclick="event.stopPropagation(); window.toggleVideoPlay('${adId}')"
        onerror="if (this.getAttribute('poster')) { this.outerHTML = '<img src=\\'' + this.getAttribute('poster') + '\\' alt=\\'Meta Ad Creative\\' referrerpolicy=\\'no-referrer\\' />'; }"
      ></video>
      <button class="sound-toggle-btn" onclick="event.stopPropagation(); toggleAudio('${adId}')" title="Mute/Unmute Audio">
        🔊
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
    const batchIds = Array.from(pendingSniffQueue).slice(0, 6);
    batchIds.forEach((id) => pendingSniffQueue.delete(id));

    await executeSniffBatch(batchIds);

    if (pendingSniffQueue.size > 0) {
      scheduleFlushSniffQueue();
    }
  }, 120);
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

          // If modal is actively inspecting this ad, refresh modal contents
          if (adModal.style.display === 'flex' && adModal.getAttribute('data-active-id') === String(adId)) {
            openModal(ad);
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
 * Toggle Video Play / Pause
 */
window.toggleVideoPlay = function (adId) {
  const video = document.getElementById(`video-${adId}`);
  if (video) {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }
};

/**
 * Audio Toggle Helper
 */
window.toggleAudio = function (adId) {
  const video = document.getElementById(`video-${adId}`);
  if (video) {
    video.muted = !video.muted;
    const btn = video.parentElement.querySelector('.sound-toggle-btn');
    if (btn) btn.textContent = video.muted ? '🔇' : '🔊';
    if (!video.muted && video.paused) video.play();
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
  window.scrollTo({ top: 380, behavior: 'smooth' });
}

/**
 * Modal Inspection (2-Column Split)
 */
window.openModalById = function (adId) {
  const ad = (state.currentAds || []).find(a => String(a.id) === String(adId));
  if (ad) openModal(ad);
};

function openModal(ad) {
  adModal.setAttribute('data-active-id', String(ad.id));
  
  // 1. Header Information (Single source of brand name & ID)
  if (modalBrandAvatar) {
    modalBrandAvatar.textContent = (ad.pageName || 'A').charAt(0).toUpperCase();
  }
  if (modalPageName) modalPageName.textContent = ad.pageName;
  if (modalAdId) modalAdId.textContent = `ID: ${ad.id}`;
  if (modalLibraryLink) modalLibraryLink.href = ad.adLibraryUrl;

  const media = state.resolvedMediaMap[ad.id] || ad.media;
  const destUrl = (media && media.destinationUrl) || ad.destinationUrl || '';
  const cta = (media && media.ctaText) || ad.ctaText || 'Learn More';
  
  let domain = ad.displayDomain || '';
  if (!domain && destUrl) {
    try {
      domain = new URL(destUrl).hostname.replace(/^www\./, '');
    } catch (e) {}
  }
  if (!domain) {
    domain = ad.copy.caption || ad.pageName || 'Website';
  }

  // 2. Intelligent Copy & Messaging Deduplication
  const rawHeadline = (ad.copy?.headline || '').trim();
  const rawBody = (ad.copy?.body || '').trim();
  const pageName = (ad.pageName || '').trim();

  // Deduplicate: If headline is identical to body or brand name or is generic, hide headline
  const isDuplicateHeadline = !rawHeadline || 
    rawHeadline.toLowerCase() === rawBody.toLowerCase() || 
    rawHeadline.toLowerCase() === pageName.toLowerCase() ||
    rawHeadline.toLowerCase() === 'no headline';

  if (!isDuplicateHeadline) {
    modalHeadline.textContent = rawHeadline;
    modalHeadline.style.display = 'block';
  } else {
    modalHeadline.textContent = '';
    modalHeadline.style.display = 'none';
  }

  if (rawBody) {
    modalBodyText.textContent = rawBody;
    modalBodyText.style.display = 'block';
  } else if (isDuplicateHeadline && rawHeadline && rawHeadline.toLowerCase() !== 'no headline') {
    // If body was empty but headline held the message, show it as body
    modalBodyText.textContent = rawHeadline;
    modalBodyText.style.display = 'block';
  } else {
    modalBodyText.textContent = 'Creative visual copy without separate text caption.';
    modalBodyText.style.display = 'block';
  }

  if (modalHookPill) {
    modalHookPill.textContent = ad.aiAnalysis?.creativeAngle || ad.copy?.primaryHook || 'Direct-Response';
  }

  // 3. Unified Destination & Action Card
  if (modalDestUrlText) {
    const displayUrl = destUrl ? destUrl.replace(/^https?:\/\//, '') : (domain ? `${domain} (Direct link pending)` : 'Meta Ad Library');
    modalDestUrlText.textContent = displayUrl;
    modalDestUrlText.title = destUrl || (domain ? `https://${domain}` : ad.adLibraryUrl);
  }

  if (modalVisitDestBtnText) {
    modalVisitDestBtnText.textContent = cta ? `Visit (${cta})` : 'Visit Site';
  }

  if (modalVisitDestBtn) {
    modalVisitDestBtn.href = destUrl || (domain ? `https://${domain}` : ad.adLibraryUrl);
  }

  if (modalCopyDestBtn) {
    modalCopyDestBtn.onclick = (e) => {
      e.preventDefault();
      const toCopy = destUrl || (domain ? `https://${domain}` : ad.adLibraryUrl);
      copyToClipboard(toCopy, modalCopyDestBtn, '✅ Copied!');
    };
  }

  if (modalDestStatusPill) {
    if (destUrl && (destUrl.includes('hop.clickbank.net') || destUrl.includes('aff_c') || destUrl.includes('affid') || destUrl.includes('hop='))) {
      modalDestStatusPill.textContent = 'Affiliate Tracking Link';
      modalDestStatusPill.className = 'dest-status-pill affiliate';
    } else if (destUrl) {
      modalDestStatusPill.textContent = 'Verified Landing Page';
      modalDestStatusPill.className = 'dest-status-pill direct';
    } else {
      modalDestStatusPill.textContent = 'Display Domain';
      modalDestStatusPill.className = 'dest-status-pill';
    }
  }

  // 4. Campaign Stats Grid
  const platforms = (ad.stats.platforms || ['facebook', 'instagram']).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ');
  modalStatsRow.innerHTML = `
    <div class="stat-item">
      <span class="stat-label">Campaign Status</span>
      <span class="stat-value ${ad.stats.isActive ? 'highlight-green' : ''}">
        ${ad.stats.isActive ? '🟢 Active' : '⚪ Ended'} (${ad.stats.flightDays}d)
      </span>
    </div>
    <div class="stat-item">
      <span class="stat-label">Scale & Longevity</span>
      <span class="stat-value highlight-amber">${ad.stats.scaleTier.includes('High') ? 'Top Scaler' : (ad.stats.scaleTier.includes('Mid') ? 'Active Run' : 'Recent')}</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">Target Countries</span>
      <span class="stat-value">${(ad.stats.countries || []).join(', ') || 'Global'}</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">Platforms</span>
      <span class="stat-value">${platforms}</span>
    </div>
  `;

  // 5. Media & Creative Asset Toolbar (Focused Studio Display)
  if (media && media.videoUrl) {
    const backdrop = media.thumbnailUrl ? `<div class="media-backdrop" style="background-image: url('${media.thumbnailUrl}')"></div>` : '';
    modalMediaWrap.innerHTML = `
      ${backdrop}
      <video src="${media.videoUrl}" poster="${media.thumbnailUrl || ''}" controls autoplay playsinline referrerpolicy="no-referrer"></video>
    `;
    modalMediaActions.innerHTML = `
      <div class="asset-toolbar-wrap">
        <a href="${media.videoUrl}" target="_blank" download="creative_${ad.id}.mp4" class="asset-btn primary" title="Download High-Definition MP4 Video">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>Save Video</span>
          <span class="asset-pill-tag">HD MP4</span>
        </a>
        <button type="button" class="asset-btn secondary" onclick="copyAssetLink('${media.videoUrl}', this)" title="Copy Direct MP4 Stream Link">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
          </svg>
          <span>Copy Stream URL</span>
        </button>
        <a href="${media.videoUrl}" target="_blank" rel="noopener noreferrer" class="asset-btn icon-only" title="Open Video in Full Browser Window">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </a>
      </div>
    `;
  } else if (media && media.thumbnailUrl) {
    modalMediaWrap.innerHTML = `
      <div class="media-backdrop" style="background-image: url('${media.thumbnailUrl}')"></div>
      <img src="${media.thumbnailUrl}" alt="${ad.pageName}" referrerpolicy="no-referrer" onerror="this.parentElement.innerHTML='<div class=\\'shimmer-placeholder static-preview\\'><span>Meta Ad Snapshot</span></div>'" />
    `;
    modalMediaActions.innerHTML = `
      <div class="asset-toolbar-wrap">
        <a href="${media.thumbnailUrl}" target="_blank" download="creative_${ad.id}.jpg" class="asset-btn primary" title="Download High-Resolution Image Creative">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>Save Image</span>
          <span class="asset-pill-tag">Original</span>
        </a>
        <button type="button" class="asset-btn secondary" onclick="copyAssetLink('${media.thumbnailUrl}', this)" title="Copy Direct Image CDN Link">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
          </svg>
          <span>Copy Image URL</span>
        </button>
        <a href="${media.thumbnailUrl}" target="_blank" rel="noopener noreferrer" class="asset-btn icon-only" title="Open Image in Full Browser Window">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </a>
      </div>
    `;
  } else {
    modalMediaWrap.innerHTML = `
      <div class="shimmer-placeholder static-preview"><span>Meta Ad Creative Preview</span></div>
    `;
    modalMediaActions.innerHTML = '';
  }

  adModal.style.display = 'flex';
}

function closeModal() {
  adModal.style.display = 'none';
  adModal.removeAttribute('data-active-id');
  modalMediaWrap.innerHTML = '';
  modalMediaActions.innerHTML = '';
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
