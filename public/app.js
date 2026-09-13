/**
 * Ascendant Labs — Air Passenger Rights & Compensation Intelligence Hub
 * Client-Side Interactive Engine & Flight Delay Calculator
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
    // Mobile Menu Drawer ESC Key Handling
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mobileMenuOverlay && mobileMenuOverlay.classList.contains('open')) {
        mobileMenuOverlay.classList.remove('open');
        if (mobileNavToggle) mobileNavToggle.setAttribute('aria-expanded', 'false');
      }
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
  const stickyPayoutVal = document.getElementById('sticky-payout-val');
  const mobileStickyBar = document.getElementById('mobile-sticky-bar');
  const flightCalcSection = document.getElementById('flight-compensation');

  // Route presets metadata (approx great-circle km)
  const ROUTE_PRESETS = {
    'LHR-SIN': { dep: 'LHR', arr: 'SIN', name: 'London (LHR) → Singapore (SIN)', km: 10887, law: 'UK 261 / EU 261', airline: 'BA / SQ' },
    'FRA-JFK': { dep: 'FRA', arr: 'JFK', name: 'Frankfurt (FRA) → New York (JFK)', km: 6200, law: 'EU Regulation 261', airline: 'LH / DL' },
    'CDG-LAX': { dep: 'CDG', arr: 'LAX', name: 'Paris (CDG) → Los Angeles (LAX)', km: 9100, law: 'EU Regulation 261', airline: 'AF / DL' },
    'AMS-HND': { dep: 'AMS', arr: 'HND', name: 'Amsterdam (AMS) → Tokyo (HND)', km: 9310, law: 'EU Regulation 261', airline: 'KL / JL' },
    'MAD-MIA': { dep: 'MAD', arr: 'MIA', name: 'Madrid (MAD) → Miami (MIA)', km: 7100, law: 'EU Regulation 261', airline: 'IB / AA' }
  };

  let currentRoute = { ...ROUTE_PRESETS['LHR-SIN'] };
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
      return { eur: 300, usd: 330, sgd: 430, eligible: true, text: 'Long-Haul (> 3,500 km, 3-4h delay)' };
    }
    return { eur: 600, usd: 650, sgd: 850, eligible: true, text: 'Long-Haul (> 3,500 km, Full Payout)' };
  }

  function updateCalculatorDisplay() {
    const result = calculateCompensation(currentRoute.km, currentDelayHours);

    if (payoutBigNumber) {
      payoutBigNumber.textContent = result.eur > 0 ? `€${result.eur}` : '€0';
    }

    if (stickyPayoutVal) {
      stickyPayoutVal.textContent = result.eur > 0 ? `€${result.eur}` : '€600';
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
      const claimUrl = `https://ascendantlabs.co/r/airhelp?flight_number=${encodeURIComponent(flightNum)}&departure=${encodeURIComponent(currentRoute.dep)}&arrival=${encodeURIComponent(currentRoute.arr)}&delay=${currentDelayHours >= 3 ? '180' : '60'}`;
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
        currentRoute = { ...ROUTE_PRESETS[key] };
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

  // Custom Input Listeners with uppercase formatting
  if (flightNumberInput) {
    flightNumberInput.addEventListener('input', () => {
      flightNumberInput.value = flightNumberInput.value.toUpperCase();
      updateCalculatorDisplay();
    });
  }

  if (departureInput) {
    departureInput.addEventListener('input', () => {
      departureInput.value = departureInput.value.toUpperCase();
      currentRoute.dep = departureInput.value;
      updateCalculatorDisplay();
    });
  }

  if (arrivalInput) {
    arrivalInput.addEventListener('input', () => {
      arrivalInput.value = arrivalInput.value.toUpperCase();
      currentRoute.arr = arrivalInput.value;
      updateCalculatorDisplay();
    });
  }

  // --- Sticky Mobile Quick-Action Bar Visibility Logic ---
  function handleStickyBarVisibility() {
    if (!mobileStickyBar) return;
    const scrollY = window.scrollY || window.pageYOffset;
    const triggerOffset = 350;

    let isCalcInView = false;
    if (flightCalcSection) {
      const rect = flightCalcSection.getBoundingClientRect();
      if (rect.top <= window.innerHeight * 0.75 && rect.bottom >= window.innerHeight * 0.25) {
        isCalcInView = true;
      }
    }

    if (scrollY > triggerOffset && !isCalcInView) {
      mobileStickyBar.classList.add('visible');
    } else {
      mobileStickyBar.classList.remove('visible');
    }
  }

  window.addEventListener('scroll', handleStickyBarVisibility, { passive: true });

  // Initialize
  updateCalculatorDisplay();
  handleStickyBarVisibility();

})();
