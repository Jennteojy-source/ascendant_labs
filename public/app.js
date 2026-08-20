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

    const affiliateLinks = document.querySelectorAll('a[href^="/r/"], a[href^="/nordvpn/"]');
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
        // Toggle current item
        item.classList.toggle('active', !isActive);
      });
    }
  });

})();
