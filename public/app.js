/**
 * Ascendant Labs — Digital Privacy & Cybersecurity Intelligence Hub
 * Client-Side Interactive Engine & Telemetry Handler
 */

(function () {
  'use strict';

  // --- Theme Management ---
  const themeToggle = document.getElementById('theme-toggle');
  const html = document.documentElement;

  function initTheme() {
    const savedTheme = localStorage.getItem('ascendant_theme') || 'dark';
    html.setAttribute('data-theme', savedTheme);
  }

  function toggleTheme() {
    const currentTheme = html.getAttribute('data-theme') || 'dark';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', nextTheme);
    localStorage.setItem('ascendant_theme', nextTheme);
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
  initTheme();

  // --- Mobile Menu Drawer ---
  const mobileNavToggle = document.getElementById('mobile-nav-toggle');
  const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');

  if (mobileNavToggle && mobileMenuOverlay) {
    mobileNavToggle.addEventListener('click', () => {
      mobileMenuOverlay.classList.toggle('open');
      const isExpanded = mobileMenuOverlay.classList.contains('open');
      mobileNavToggle.setAttribute('aria-expanded', isExpanded);
    });

    // Close when clicking a link inside
    mobileMenuOverlay.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        mobileMenuOverlay.classList.remove('open');
      });
    });
  }

  // --- Outbound Link Parameter Propagation ---
  // Ensure that any tracking tokens (fbclid, click_id, c, utm_*) on the current page are passed forward to /r/ links & tools
  function propagateTrackingParams() {
    const currentParams = new URLSearchParams(window.location.search);
    if (!currentParams.toString()) return;

    const affiliateLinks = document.querySelectorAll('a[href^="/r/"]');
    affiliateLinks.forEach((link) => {
      try {
        const href = link.getAttribute('href');
        const url = new URL(href, window.location.origin);
        currentParams.forEach((val, key) => {
          if (!url.searchParams.has(key)) {
            url.searchParams.set(key, val);
          }
        });
        link.setAttribute('href', url.pathname + url.search);
      } catch (_) {
        // Fallback for relative paths
      }
    });
  }

  propagateTrackingParams();

  // --- Live Telemetry Preview in Hero ---
  const ipEl = document.getElementById('live-ip-val');
  const ispEl = document.getElementById('live-isp-val');
  const locEl = document.getElementById('live-loc-val');
  const statusBadge = document.getElementById('live-status-badge');

  async function fetchLiveTelemetry() {
    try {
      // First attempt local Firebase telemetry function
      const res = await fetch('/api/telemetry', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.ip) {
          updateTelemetryDisplay(data);
          return;
        }
      }
    } catch (_) {
      // Ignore and fallback
    }

    // Fallback: public client-side IP lookup if local function is offline
    try {
      const fallbackRes = await fetch('https://ipapi.co/json/', { cache: 'no-store' });
      if (fallbackRes.ok) {
        const data = await fallbackRes.json();
        updateTelemetryDisplay({
          ip: data.ip,
          isp: data.org || data.asn,
          city: data.city,
          country: data.country_name,
        });
        return;
      }
    } catch (_) {
      // Static fallback display
    }

    // Default informative state if adblockers block IP services
    if (ipEl) ipEl.innerHTML = '<span class="exposed">Detected (Unprotected)</span>';
    if (ispEl) ispEl.textContent = 'Standard ISP Network';
    if (locEl) locEl.textContent = 'Visible to Web Servers';
  }

  function updateTelemetryDisplay(data) {
    if (ipEl && data.ip) {
      ipEl.textContent = data.ip;
      ipEl.classList.add('exposed');
    }
    if (ispEl) {
      ispEl.textContent = data.isp || 'Visible ISP / Carrier';
      ispEl.classList.add('exposed');
    }
    if (locEl) {
      const locText = [data.city, data.country].filter(Boolean).join(', ') || 'Exposed Location';
      locEl.textContent = locText;
      locEl.classList.add('exposed');
    }
    if (statusBadge) {
      statusBadge.textContent = '3 EXPOSURE POINTS DETECTED';
    }
  }

  fetchLiveTelemetry();

  // --- FAQ Accordion Logic ---
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach((item) => {
    const questionBtn = item.querySelector('.faq-question');
    if (questionBtn) {
      questionBtn.addEventListener('click', () => {
        const isActive = item.classList.contains('active');
        // Close other items
        faqItems.forEach((other) => {
          if (other !== item) other.classList.remove('active');
        });
        item.classList.toggle('active', !isActive);
      });
    }
  });

  // --- Flight Delay Compensation Interactive Calculator ---
  const flightNumberInput = document.getElementById('calc-flight-number');
  const departureInput = document.getElementById('calc-departure');
  const arrivalInput = document.getElementById('calc-arrival');
  const delayButtons = document.querySelectorAll('.delay-tier-btn');
  const presetButtons = document.querySelectorAll('.route-preset-btn');
  const payoutBigNumber = document.getElementById('payout-amount-val');
  const payoutCurrencySub = document.getElementById('payout-currency-sub');
  const payoutDistanceVal = document.getElementById('payout-distance-val');
  const payoutLawVal = document.getElementById('payout-law-val');
  const payoutStatusPill = document.getElementById('payout-status-pill');
  const claimCtaBtn = document.getElementById('calc-claim-cta');

  // Route presets metadata (approx great-circle km)
  const ROUTE_PRESETS = {
    'LHR-SIN': { dep: 'LHR', arr: 'SIN', name: 'London (LHR) → Singapore (SIN)', km: 10887, law: 'UK 261 / EU 261', airline: 'BA / SQ' },
    'FRA-JFK': { dep: 'FRA', arr: 'JFK', name: 'Frankfurt (FRA) → New York (JFK)', km: 6200, law: 'EU Regulation 261', airline: 'LH / DL' },
    'CDG-LAX': { dep: 'CDG', arr: 'LAX', name: 'Paris (CDG) → Los Angeles (LAX)', km: 9100, law: 'EU Regulation 261', airline: 'AF / DL' },
    'AMS-HND': { dep: 'AMS', arr: 'HND', name: 'Amsterdam (AMS) → Tokyo (HND)', km: 9310, law: 'EU Regulation 261', airline: 'KL / JL' },
    'MAD-MIA': { dep: 'MAD', arr: 'MIA', name: 'Madrid (MAD) → Miami (MIA)', km: 7100, law: 'EU Regulation 261', airline: 'IB / AA' }
  };

  let currentRoute = ROUTE_PRESETS['LHR-SIN'];
  let currentDelayHours = 3.5; // default 3-4 hours

  function calculateCompensation(km, hours) {
    if (hours < 3) {
      return { eur: 0, usd: 0, sgd: 0, eligible: false, text: 'Refreshments & Care Only' };
    }
    if (km <= 1500) {
      return { eur: 250, usd: 275, sgd: 360, eligible: true, text: 'Short-Haul (≤ 1,500 km)' };
    }
    if (km > 1500 && km <= 3500) {
      return { eur: 400, usd: 440, sgd: 580, eligible: true, text: 'Medium-Haul (1,500–3,500 km)' };
    }
    // Long-haul > 3500 km
    if (hours >= 3 && hours < 4) {
      // For delays between 3 and 4 hours on flights >3,500km, airlines may reduce compensation by 50% under Article 7(2)(c)
      return { eur: 300, usd: 330, sgd: 430, eligible: true, text: 'Long-Haul (> 3,500 km, 3-4h)' };
    }
    return { eur: 600, usd: 650, sgd: 850, eligible: true, text: 'Long-Haul (> 3,500 km, Full Payout)' };
  }

  function updateCalculatorDisplay() {
    const result = calculateCompensation(currentRoute.km, currentDelayHours);

    if (payoutBigNumber) {
      payoutBigNumber.textContent = result.eur > 0 ? `€${result.eur}` : '€0';
    }

    if (payoutCurrencySub) {
      payoutCurrencySub.textContent = result.eur > 0 
        ? `~$${result.usd} USD / ~$${result.sgd} SGD per passenger` 
        : 'Delays under 3h qualify for food & hotel, not statutory cash';
    }

    if (payoutDistanceVal) {
      payoutDistanceVal.textContent = `${result.text} (${currentRoute.km.toLocaleString()} km)`;
    }

    if (payoutLawVal) {
      payoutLawVal.textContent = currentRoute.law;
    }

    if (payoutStatusPill) {
      if (result.eligible) {
        payoutStatusPill.textContent = 'ELIGIBLE FOR STATUTORY CASH';
        payoutStatusPill.style.background = 'rgba(16, 185, 129, 0.15)';
        payoutStatusPill.style.color = 'var(--emerald-400)';
        payoutStatusPill.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      } else {
        payoutStatusPill.textContent = 'ASSISTANCE ONLY (<3 HOURS)';
        payoutStatusPill.style.background = 'rgba(245, 158, 11, 0.15)';
        payoutStatusPill.style.color = 'var(--amber-400)';
        payoutStatusPill.style.borderColor = 'rgba(245, 158, 11, 0.3)';
      }
    }

    if (claimCtaBtn) {
      const flightNum = (flightNumberInput && flightNumberInput.value.trim()) || 'SQ325';
      const claimUrl = `https://funnel.airhelp.com/claims/new?lang=en&flight_number=${encodeURIComponent(flightNum)}&departure=${encodeURIComponent(currentRoute.dep)}&arrival=${encodeURIComponent(currentRoute.arr)}&delay=${currentDelayHours >= 3 ? '180' : '60'}`;
      claimCtaBtn.setAttribute('href', claimUrl);
      claimCtaBtn.innerHTML = result.eligible 
        ? `<span>Initiate Statutory Claim for €${result.eur}</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`
        : `<span>Check Flight Eligibility</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;
    }
  }

  // Preset Route Button Listeners
  presetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      presetButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const key = btn.getAttribute('data-route');
      if (ROUTE_PRESETS[key]) {
        currentRoute = ROUTE_PRESETS[key];
        if (departureInput) departureInput.value = currentRoute.dep;
        if (arrivalInput) arrivalInput.value = currentRoute.arr;
        updateCalculatorDisplay();
      }
    });
  });

  // Delay Tier Buttons
  delayButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      delayButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentDelayHours = parseFloat(btn.getAttribute('data-hours') || '3.5');
      updateCalculatorDisplay();
    });
  });

  // Custom Input Listeners
  if (flightNumberInput) {
    flightNumberInput.addEventListener('input', updateCalculatorDisplay);
  }

  // Initialize
  updateCalculatorDisplay();

})();
