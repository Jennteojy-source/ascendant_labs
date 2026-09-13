/**
 * Ascendant Labs — Flight Compensation Claim Portal Engine
 * Native route form, AirHelp redirect, theme, FAQ, Meta Pixel + CAPI Lead
 */

(function () {
  'use strict';

  var AIRPORTS = window.ASCENDANT_AIRPORTS || [];
  var I18N = window.ASCENDANT_I18N || { langs: [{ id: 'en', label: 'EN' }], dict: { en: {} }, countryLang: {}, airhelp: { en: 'en' } };
  var EUR_COUNTRIES = { AT:1, BE:1, BG:1, HR:1, CY:1, CZ:1, DK:1, EE:1, FI:1, FR:1, DE:1, GR:1, HU:1, IE:1, IT:1, LV:1, LT:1, LU:1, MT:1, NL:1, PL:1, PT:1, RO:1, SK:1, SI:1, ES:1, SE:1, GB:1, UK:1, CH:1, NO:1, IS:1, LI:1, AD:1, MC:1 };
  var currentLang = 'en';
  var currentCurrency = document.documentElement.getAttribute('data-currency') || 'EUR';
  var currentPayout = currentCurrency === 'USD' ? '$650' : '€600';
  var currentCountry = '';

  function supportedLang(code) {
    var id = String(code || '').toLowerCase().replace('_', '-');
    if (id === 'pt-br') return 'pt';
    id = id.split('-')[0];
    if (id === 'nb' || id === 'nn') id = 'en';
    return I18N.dict && I18N.dict[id] ? id : '';
  }

  function airhelpLang() {
    var map = I18N.airhelp || {};
    var code = map[currentLang] || 'en';
    var nav = String(navigator.language || '').toLowerCase();
    if (currentLang === 'pt' && (currentCountry === 'BR' || nav === 'pt-br' || nav.indexOf('pt-br') === 0)) {
      return 'pt-BR';
    }
    return code;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function t(key) {
    var dict = (I18N.dict && I18N.dict[currentLang]) || {};
    var fallback = (I18N.dict && I18N.dict.en) || {};
    var str = dict[key] || fallback[key] || key;
    return String(str).replace(/\{payout\}/g, currentPayout);
  }

  function tHtml(key) {
    var dict = (I18N.dict && I18N.dict[currentLang]) || {};
    var fallback = (I18N.dict && I18N.dict.en) || {};
    var raw = dict[key] || fallback[key] || key;
    return escapeHtml(raw).replace(
      /\{payout\}/g,
      '<span class="money-payout">' + escapeHtml(currentPayout) + '</span>'
    );
  }

  function applyI18n() {
    document.documentElement.lang = currentLang;
    document.documentElement.dir = currentLang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('data-lang', currentLang);
    document.title = t('meta.title');
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.innerHTML = tHtml(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
    });
    var select = document.getElementById('lang-select');
    if (select && select.value !== currentLang) select.value = currentLang;
  }

  function applyCurrency(ccy) {
    currentCurrency = ccy === 'USD' ? 'USD' : 'EUR';
    currentPayout = currentCurrency === 'USD' ? '$650' : '€600';
    document.documentElement.setAttribute('data-currency', currentCurrency);
    try { sessionStorage.setItem('al_ccy', currentCurrency); } catch (e) {}
    applyI18n();
  }

  function applyLang(lang, manual) {
    var next = supportedLang(lang) || 'en';
    currentLang = next;
    try {
      sessionStorage.setItem('al_lang', next);
      if (manual) localStorage.setItem('al_lang_manual', '1');
    } catch (e) {}
    applyI18n();
  }

  function langFromBrowser() {
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    for (var i = 0; i < list.length; i++) {
      var hit = supportedLang(list[i]);
      if (hit) return hit;
    }
    return '';
  }

  function populateLangSelect() {
    var select = document.getElementById('lang-select');
    if (!select || !I18N.langs) return;
    select.innerHTML = I18N.langs.map(function (item) {
      return '<option value="' + item.id + '">' + item.label + '</option>';
    }).join('');
    select.value = currentLang;
    select.addEventListener('change', function () {
      applyLang(select.value, true);
    });
  }

  function detectLocale() {
    var queryLang = supportedLang(new URLSearchParams(window.location.search).get('lang'));
    var storedLang = '';
    var manual = false;
    try {
      storedLang = sessionStorage.getItem('al_lang') || '';
      manual = localStorage.getItem('al_lang_manual') === '1';
    } catch (e) {}
    applyLang(queryLang || (manual && storedLang) || langFromBrowser() || storedLang || 'en');
    applyCurrency(currentCurrency);
    populateLangSelect();

    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 1800);
    fetch('https://get.geojs.io/v1/ip/country.json', {
      signal: controller ? controller.signal : undefined
    }).then(function (res) { return res.json(); }).then(function (data) {
      clearTimeout(timer);
      var cc = String((data && (data.country || data.country_code)) || '').toUpperCase();
      if (!cc) return;
      currentCountry = cc;
      applyCurrency(EUR_COUNTRIES[cc] ? 'EUR' : 'USD');
      if (!queryLang && !manual) {
        var ipLang = (I18N.countryLang && I18N.countryLang[cc]) || '';
        var browserLang = langFromBrowser();
        if (!browserLang && ipLang) applyLang(ipLang);
        else if (browserLang === 'en' && ipLang && ipLang !== 'en') applyLang(ipLang);
      }
    }).catch(function () {
      clearTimeout(timer);
    });
  }

  detectLocale();

  function trackMetaEvent(eventName, params, eventId) {
    if (typeof window.fbq !== 'function') return;
    try {
      if (eventId) {
        window.fbq('track', eventName, params || {}, { eventID: eventId });
      } else {
        window.fbq('track', eventName, params || {});
      }
    } catch (e) {
      console.warn('Meta Pixel event error:', e);
    }
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return ('lead_' + window.crypto.randomUUID()).replace(/-/g, '_');
    }
    return 'lead_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }

  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[$()*+./?[\\\]^{|}-]/g, '\\$&') + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  }

  function getFbc() {
    var fbc = getCookie('_fbc');
    if (fbc) return fbc;
    var fbclid = new URLSearchParams(window.location.search).get('fbclid');
    if (!fbclid) return '';
    return 'fb.1.' + Date.now() + '.' + fbclid;
  }

  function formatAirport(airport) {
    return airport.city + ' (' + airport.iata + ') · ' + airport.name;
  }

  function findAirport(query) {
    var n = String(query || '').trim().toLowerCase();
    if (!n) return null;
    var iataHit = AIRPORTS.find(function (a) { return a.iata.toLowerCase() === n; });
    if (iataHit) return iataHit;
    var exactCity = AIRPORTS.filter(function (a) { return a.city.toLowerCase() === n; });
    if (exactCity.length === 1) return exactCity[0];
    return null;
  }

  function filterAirports(query) {
    var n = String(query || '').trim().toLowerCase();
    if (n.length < 1) return [];
    var scored = [];
    for (var i = 0; i < AIRPORTS.length; i++) {
      var a = AIRPORTS[i];
      var iata = a.iata.toLowerCase();
      var city = a.city.toLowerCase();
      var name = a.name.toLowerCase();
      var hay = city + ' ' + name + ' ' + iata + ' ' + String(a.country || '').toLowerCase();
      var score = 0;
      if (iata === n) score = 100;
      else if (iata.indexOf(n) === 0) score = 80;
      else if (city.indexOf(n) === 0) score = 70;
      else if (city.indexOf(n) !== -1) score = 50;
      else if (name.indexOf(n) !== -1) score = 40;
      else if (hay.indexOf(n) !== -1) score = 20;
      if (score) scored.push({ a: a, score: score });
    }
    scored.sort(function (x, y) { return y.score - x.score; });
    return scored.slice(0, 8).map(function (x) { return x.a; });
  }

  function buildFallbackUrl(originIata, destIata, disruptionType, clickId) {
    try {
      var targetFunnel = 'https://funnel.airhelp.com/claims/new/trip-details?departureAirportIata=' + encodeURIComponent(originIata) +
        '&arrivalAirportIata=' + encodeURIComponent(destIata) +
        (disruptionType ? '&disruption_type=' + encodeURIComponent(disruptionType) : '') +
        '&lang=' + encodeURIComponent(airhelpLang());
      return 'https://tp.media/r?campaign_id=120&marker=777015&p=9139&trs=573423' +
        (clickId ? '&sub_id=' + encodeURIComponent(clickId) : '') +
        '&u=' + encodeURIComponent(targetFunnel);
    } catch (_) {
      return 'https://airhelp.tpx.lu/3XDklWHQ';
    }
  }

  function bindAutocomplete(input, listEl, hiddenIata) {
    var activeIndex = -1;
    var results = [];

    function closeList() {
      listEl.hidden = true;
      listEl.innerHTML = '';
      activeIndex = -1;
    }

    function render(items) {
      results = items;
      activeIndex = items.length ? 0 : -1;
      if (!items.length) {
        closeList();
        return;
      }
      listEl.innerHTML = items.map(function (airport, idx) {
        return '<li role="option" data-iata="' + airport.iata + '" class="' + (idx === 0 ? 'is-active' : '') + '">' +
          '<span class="suggest-iata">' + airport.iata + '</span>' +
          '<span class="suggest-meta">' + airport.city + ' · ' + airport.name + '</span>' +
          '</li>';
      }).join('');
      listEl.hidden = false;
    }

    function selectAirport(airport) {
      if (!airport) return;
      input.value = formatAirport(airport);
      hiddenIata.value = airport.iata;
      input.dataset.iata = airport.iata;
      closeList();
    }

    input.addEventListener('input', function () {
      hiddenIata.value = '';
      input.dataset.iata = '';
      render(filterAirports(input.value));
    });

    input.addEventListener('focus', function () {
      if (input.value.trim()) render(filterAirports(input.value));
    });

    input.addEventListener('keydown', function (e) {
      if (listEl.hidden || !results.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % results.length;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = (activeIndex - 1 + results.length) % results.length;
      } else if (e.key === 'Enter' && activeIndex >= 0) {
        e.preventDefault();
        selectAirport(results[activeIndex]);
        return;
      } else if (e.key === 'Escape') {
        closeList();
        return;
      } else {
        return;
      }
      Array.prototype.forEach.call(listEl.children, function (el, idx) {
        el.classList.toggle('is-active', idx === activeIndex);
      });
    });

    listEl.addEventListener('mousedown', function (e) {
      var item = e.target.closest('[data-iata]');
      if (!item) return;
      e.preventDefault();
      selectAirport(AIRPORTS.find(function (a) { return a.iata === item.getAttribute('data-iata'); }));
    });

    document.addEventListener('click', function (e) {
      if (!input.contains(e.target) && !listEl.contains(e.target)) closeList();
    });

    return {
      resolve: function () {
        if (hiddenIata.value) {
          return AIRPORTS.find(function (a) { return a.iata === hiddenIata.value; }) || findAirport(hiddenIata.value);
        }
        return findAirport(input.value);
      },
      selectAirport: selectAirport,
      getValue: function () { return hiddenIata.value || (findAirport(input.value) || {}).iata || ''; }
    };
  }

  function initRouteForm(form) {
    var originInput = form.querySelector('[data-role="origin"]');
    var destInput = form.querySelector('[data-role="dest"]');
    var originIata = form.querySelector('[data-role="origin-iata"]');
    var destIata = form.querySelector('[data-role="dest-iata"]');
    var originList = form.querySelector('[data-role="origin-suggest"]');
    var destList = form.querySelector('[data-role="dest-suggest"]');
    var swapBtn = form.querySelector('[data-role="swap"]');
    var submitBtn = form.querySelector('[type="submit"]');
    var errorEl = form.querySelector('[data-role="form-error"]');
    if (!originInput || !destInput) return;

    var originCtl = bindAutocomplete(originInput, originList, originIata);
    var destCtl = bindAutocomplete(destInput, destList, destIata);

    if (swapBtn) {
      swapBtn.addEventListener('click', function () {
        var originAirport = originCtl.resolve();
        var destAirport = destCtl.resolve();
        var originVal = originInput.value;
        var destVal = destInput.value;
        originInput.value = destVal;
        destInput.value = originVal;
        originIata.value = destAirport ? destAirport.iata : '';
        destIata.value = originAirport ? originAirport.iata : '';
        originInput.dataset.iata = originIata.value;
        destInput.dataset.iata = destIata.value;
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = '';
      }

      var origin = originCtl.resolve();
      var dest = destCtl.resolve();
      if (!origin || !dest) {
        if (errorEl) {
          errorEl.hidden = false;
          errorEl.textContent = t('form.error.missing');
        }
        originInput.focus();
        return;
      }
      if (origin.iata === dest.iata) {
        if (errorEl) {
          errorEl.hidden = false;
          errorEl.textContent = t('form.error.same');
        }
        return;
      }

      var disruptionRadio = form.querySelector('[data-role="disruption-radio"]:checked');
      var disruptionType = disruptionRadio ? disruptionRadio.value : 'delayed';

      var eventId = uuid();
      var source = form.getAttribute('data-source') || 'hero';
      var payload = {
        originIata: origin.iata,
        destIata: dest.iata,
        disruptionType: disruptionType,
        originLabel: formatAirport(origin),
        destLabel: formatAirport(dest),
        eventId: eventId,
        fbp: getCookie('_fbp'),
        fbc: getFbc(),
        source: source,
        lang: currentLang,
        eventSourceUrl: window.location.href
      };

      trackMetaEvent('Lead', {
        content_name: origin.iata + '-' + dest.iata + ' (' + disruptionType + ')',
        content_category: 'Flight Compensation Route',
        content_ids: [origin.iata + '-' + dest.iata],
        content_type: 'product',
        status: disruptionType
      }, eventId);

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('is-loading');
        submitBtn.setAttribute('aria-busy', 'true');
      }

      var fallback = buildFallbackUrl(origin.iata, dest.iata, disruptionType, eventId);
      var redirected = false;
      function go(url) {
        if (redirected) return;
        redirected = true;
        window.location.assign(url || fallback);
      }

      var controller = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { go(fallback); }, 2200);

      fetch('/api/claim-start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload),
        keepalive: true,
        signal: controller ? controller.signal : undefined
      }).then(function (res) {
        if (!res.ok) throw new Error('claim-start failed');
        return res.json();
      }).then(function (data) {
        clearTimeout(timer);
        go((data && data.redirectUrl) || fallback);
      }).catch(function () {
        clearTimeout(timer);
        go(fallback);
      });
    });
  }

  document.querySelectorAll('.claim-route-form').forEach(initRouteForm);

  var themeToggle = document.getElementById('theme-toggle');
  var html = document.documentElement;

  function initTheme() {
    var savedTheme = localStorage.getItem('ascendant_theme') || 'dark';
    html.setAttribute('data-theme', savedTheme);
  }

  function toggleTheme() {
    var currentTheme = html.getAttribute('data-theme') || 'dark';
    var nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', nextTheme);
    localStorage.setItem('ascendant_theme', nextTheme);
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
  initTheme();

  var claimPortal = document.getElementById('claim-portal');
  var originField = document.getElementById('origin-input');

  function focusClaimForm() {
    if (claimPortal) {
      claimPortal.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    window.setTimeout(function () {
      if (originField) originField.focus();
    }, 280);
  }

  document.querySelectorAll('[data-focus-claim]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var href = link.getAttribute('href') || '';
      if (href.charAt(0) === '#' || link.hasAttribute('data-focus-claim')) {
        e.preventDefault();
        focusClaimForm();
      }
    });
  });

  var faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(function (item) {
    var questionBtn = item.querySelector('.faq-question');
    if (!questionBtn) return;
    questionBtn.addEventListener('click', function () {
      var isActive = item.classList.contains('active');
      faqItems.forEach(function (other) {
        if (other !== item) other.classList.remove('active');
      });
      item.classList.toggle('active', !isActive);
    });
  });

  var portalViewTracked = false;
  function trackPortalViewOnScroll() {
    if (portalViewTracked || !claimPortal) return;
    var rect = claimPortal.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      portalViewTracked = true;
      trackMetaEvent('ViewContent', {
        content_name: 'Flight Route Claim Form',
        content_category: 'Statutory Claim Intake'
      });
      window.removeEventListener('scroll', trackPortalViewOnScroll);
    }
  }

  window.addEventListener('scroll', trackPortalViewOnScroll, { passive: true });
  trackPortalViewOnScroll();
})();
