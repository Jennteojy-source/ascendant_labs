/* Ad media rendering uses DOM APIs so signed URLs cannot break HTML attributes. */
(() => {
  const instances = new WeakMap();
  const url = value => {
    if (!value || typeof value !== 'string') return null;
    try { const u = new URL(value, location.origin); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; }
    catch { return null; }
  };
  const sources = values => [...new Set(values.map(url).filter(Boolean))];

  function assetFingerprint(value) {
    if (!value || typeof value !== 'string') return '';
    const matchProxy = value.match(/\/api\/media\/\d+\/([a-f0-9]+)/i);
    if (matchProxy) return matchProxy[1].toLowerCase();

    try {
      const u = new URL(value, location.origin);
      const pathname = u.pathname;
      const filename = pathname.split('/').filter(Boolean).pop() || '';
      const metaId = filename.match(/(?:^|[_\-.])(\d{7,30})(?:[_\-.]|$)/);
      if (metaId) return `meta:${metaId[1]}`;
      const fbid = u.searchParams.get('fbid') || u.searchParams.get('id');
      if (fbid && /^\d{7,30}$/.test(fbid)) return `meta:${fbid}`;
      return pathname.toLowerCase();
    } catch {
      return value.split('?')[0].toLowerCase();
    }
  }

  function deduplicateCreatives(items, options = {}) {
    const byFingerprint = new Map();
    const videoPosterFingerprints = new Set();
    for (const c of items) {
      if (c && c.videoUrl && c.thumbnailUrl) {
        const posterFp = assetFingerprint(c.thumbnailUrl);
        if (posterFp) videoPosterFingerprints.add(posterFp);
      }
    }
    for (const c of items) {
      if (!c) continue;
      if (!c.videoUrl && c.thumbnailUrl) {
        const imgFp = assetFingerprint(c.thumbnailUrl);
        if (videoPosterFingerprints.has(imgFp)) continue;
      }
      const key = c.videoUrl
        ? `v:${assetFingerprint(c.videoUrl)}`
        : `i:${assetFingerprint(c.thumbnailUrl || c.imageSources?.[0])}`;
      if (!key || key === 'i:' || key === 'v:') continue;
      if (!byFingerprint.has(key)) {
        byFingerprint.set(key, c);
      } else {
        const existing = byFingerprint.get(key);
        const existingArea = (existing.width || 0) * (existing.height || 0);
        const newArea = (c.width || 0) * (c.height || 0);
        if (newArea > existingArea || (!existing.width && c.width)) {
          byFingerprint.set(key, {
            ...c,
            imageSources: [...new Set([...(c.imageSources || []), ...(existing.imageSources || [])])],
            videoSources: [...new Set([...(c.videoSources || []), ...(existing.videoSources || [])])],
          });
        } else {
          existing.imageSources = [...new Set([...(existing.imageSources || []), ...(c.imageSources || [])])];
        }
      }
    }

    const collapsed = [...byFingerprint.values()];
    const imageCreatives = collapsed.filter(c => !c.videoUrl && (c.thumbnailUrl || c.imageSources?.length));
    const otherCreatives = collapsed.filter(c => c.videoUrl || (!c.thumbnailUrl && !c.imageSources?.length));

    if (imageCreatives.length <= 1) return collapsed;

    const isDCO = options.displayFormat === 'DCO'
      || options.media?.displayFormat === 'DCO'
      || imageCreatives.some(x => x.displayFormat === 'DCO');

    const byVariantSignature = new Map();
    const dedupedImages = [];

    for (const c of imageCreatives) {
      const normUrl = (c.destinationUrl || '').trim();
      const normTitle = (c.title || '').trim().toLowerCase();
      const normBody = (c.body || '').trim().toLowerCase();
      const hasVariantInfo = Boolean(normUrl || normTitle || normBody);
      const variantKey = `${normUrl}::${normTitle}::${normBody}`;

      const allIdenticalCopy = hasVariantInfo && imageCreatives.every(x =>
        `${(x.destinationUrl || '').trim()}::${(x.title || '').trim().toLowerCase()}::${(x.body || '').trim().toLowerCase()}` === variantKey
      );

      if (hasVariantInfo && (isDCO || allIdenticalCopy)) {
        if (!byVariantSignature.has(variantKey)) {
          byVariantSignature.set(variantKey, c);
        } else {
          const existing = byVariantSignature.get(variantKey);
          const existingArea = (existing.width || 0) * (existing.height || 0);
          const newArea = (c.width || 0) * (c.height || 0);
          if (newArea > existingArea || (!existing.width && c.width)) {
            byVariantSignature.set(variantKey, {
              ...c,
              imageSources: [...new Set([...(c.imageSources || []), ...(existing.imageSources || [])])],
            });
          } else {
            existing.imageSources = [...new Set([...(existing.imageSources || []), ...(c.imageSources || [])])];
          }
        }
      } else {
        dedupedImages.push(c);
      }
    }

    const finalImages = byVariantSignature.size > 0 ? [...byVariantSignature.values(), ...dedupedImages] : dedupedImages;
    return [...otherCreatives, ...finalImages];
  }

  function render(container, options) {
    if (!container) return;
    instances.get(container)?.();
    const { media, onRefresh } = options;
    const rawCreatives = (media?.creatives?.length ? media.creatives : media ? [media] : [])
      .filter(c => c.videoUrl || c.thumbnailUrl || c.videoSources?.length || c.imageSources?.length);
    const creatives = deduplicateCreatives(rawCreatives, options);
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

    function status(text) {
      message.replaceChildren();
      const label = document.createElement('span');
      label.textContent = text;
      message.append(label);
      message.hidden = !text;
    }
    function dimensions(width, height) {
      if (width > 0 && height > 0) stage.style.aspectRatio = `${width} / ${height}`;
    }
    function failed(text) {
      clearTimeout(timer);
      status(text);
    }
    function refreshFailedAsset() {
      if (disposed || refreshing || typeof onRefresh !== 'function') return;
      refreshing = true;
      onRefresh();
    }
    if (!creative) {
      stage.classList.add('media-empty');
      if (!media) {
        stage.classList.add('is-loading');
        stage.innerHTML = '<div class="media-empty-spinner"></div><span>Finding creative…</span>';
      } else {
        stage.classList.add('media-unavailable');
        stage.classList.remove('is-loading');
        stage.textContent = media.status === 'blocked'
          ? 'Meta did not provide this ad image to the automated preview.' : 'Preview unavailable';
        if (/^\d{1,40}$/.test(String(options.adId || ''))) {
          const original = document.createElement('a');
          original.href = `https://www.facebook.com/ads/library/?id=${options.adId}`;
          original.target = '_blank';
          original.rel = 'noopener noreferrer';
          original.textContent = 'View original ad ↗';
          stage.append(original);
        }
        status('');
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
        refreshFailedAsset();
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
        if (!asFallback) {
          status(creative.mediaType === 'video' ? 'Video stream paused; showing poster.' : '');
        }
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
          refreshFailedAsset();
        }
      };
      stage.replaceChildren(image);
      image.src = images[0];
      timer = setTimeout(() => {
        if (!disposed && !image.complete) {
          stage.classList.remove('is-loading');
          failed('Image is taking too long to load.');
          refreshFailedAsset();
        }
      }, 25000);
    }
    function activate() {
      if (disposed) return;
      observer?.disconnect();
      if (!videos.length) { showImage(); return; }
      stage.classList.add('is-loading');
      player = document.createElement('video');
      player.controls = true; player.playsInline = true;
      player.muted = false; player.defaultMuted = false;
      player.volume = 1;
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
        player.muted = false;
        if (player.volume === 0) player.volume = 1;
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
      // Poster errors do not emit video error events. Probe alternate posters separately.
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
  window.AdMedia = { render, dispose };
})();
