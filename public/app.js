/**
 * Ascendant Labs — Flight Compensation Claim Portal Engine
 * Theme management, smooth navigation, FAQ accordion & Meta Pixel tracking
 */

(function () {
  'use strict';

  // --- Meta Pixel Safe Event Tracker ---
  function trackMetaEvent(eventName, params = {}) {
    if (typeof window.fbq === 'function') {
      try {
        window.fbq('track', eventName, params);
      } catch (e) {
        console.warn('Meta Pixel event error:', e);
      }
    }
  }

  // --- Theme Toggle Management ---
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

  // --- Smooth Scroll to In-Page Claim Portal ---
  const claimPortal = document.getElementById('claim-portal');

  document.querySelectorAll('a[href="#claim-portal"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      if (claimPortal) {
        claimPortal.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      trackMetaEvent('InitiateCheckout', {
        content_name: 'Claim Portal Jump',
        content_category: 'Flight Compensation Form'
      });
    });
  });

  // --- FAQ Accordion Logic with Tracking ---
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

        if (!isActive) {
          const questionText = questionBtn.querySelector('span')?.textContent || 'FAQ Click';
          trackMetaEvent('Contact', { content_name: questionText });
        }
      });
    }
  });

  // --- Mobile Sticky Action Bar Visibility ---
  const mobileStickyBar = document.getElementById('mobile-sticky-bar');

  function handleStickyBarVisibility() {
    if (!mobileStickyBar) return;
    const scrollY = window.scrollY || window.pageYOffset;
    const triggerOffset = 380;

    let isPortalInView = false;
    if (claimPortal) {
      const rect = claimPortal.getBoundingClientRect();
      if (rect.top <= window.innerHeight * 0.7 && rect.bottom >= window.innerHeight * 0.3) {
        isPortalInView = true;
      }
    }

    if (scrollY > triggerOffset && !isPortalInView) {
      mobileStickyBar.classList.add('visible');
    } else {
      mobileStickyBar.classList.remove('visible');
    }
  }

  window.addEventListener('scroll', handleStickyBarVisibility, { passive: true });

  // --- Track ViewContent when Claim Portal Enters Viewport ---
  let portalViewTracked = false;
  function trackPortalViewOnScroll() {
    if (portalViewTracked || !claimPortal) return;
    const rect = claimPortal.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      portalViewTracked = true;
      trackMetaEvent('ViewContent', {
        content_name: 'AirHelp Flight Claim Intake Portal',
        content_category: 'Statutory Claim Intake'
      });
      window.removeEventListener('scroll', trackPortalViewOnScroll);
    }
  }

  window.addEventListener('scroll', trackPortalViewOnScroll, { passive: true });

  // Initialize
  handleStickyBarVisibility();
  trackPortalViewOnScroll();

})();
