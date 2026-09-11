#!/usr/bin/env node
/**
 * ClickBank Affiliate Marketplace Browser Scraper (via Chrome DevTools Protocol)
 * Ascendant Labs
 * 
 * Automates the user's active Chrome browser session on port 9222 to paginate
 * through the ClickBank Affiliate Marketplace, extracting full program details:
 * - Vendor nickname & Product Title
 * - Sales Page URL (Merchant Landing Page)
 * - Affiliate JV / Tools / Info Page URL
 * - Affiliate Contact (Email & Telegram)
 * - Performance Stats: Gravity, CVR, EPC, Avg $/Conv, Initial $/Conv, Rebill $/Conv
 * - Full Product Description & Badges
 * 
 * Usage:
 *   node ads/scrape_clickbank_marketplace.js              # Scrapes top 5 pages (250 offers)
 *   node ads/scrape_clickbank_marketplace.js --pages 10   # Scrapes 10 pages (500 offers)
 *   node ads/scrape_clickbank_marketplace.js --all        # Scrapes all available marketplace pages
 */

const fs = require('fs');
const path = require('path');

const CDP_PORT = 9222;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.messageId = 0;
    this.pending = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.id && this.pending.has(data.id)) {
            const { resolve, reject } = this.pending.get(data.id);
            this.pending.delete(data.id);
            if (data.error) reject(new Error(data.error.message || JSON.stringify(data.error)));
            else resolve(data.result);
          }
        } catch (e) {
          console.error("Failed to parse CDP response:", e);
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return res && res.result ? res.result.value : null;
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function findClickBankTab() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
  const pages = await res.json();
  const cbPage = pages.find(p => p.url && p.url.includes('clickbank.com') && p.url.includes('affiliate-marketplace'));
  if (cbPage) return cbPage;
  return pages.find(p => p.title && p.title.toLowerCase().includes('clickbank'));
}

const EXTRACT_PAGE_OFFERS_JS = `(() => {
  const titleLinks = Array.from(document.querySelectorAll('a[href*="#/offer-details?offer="]'));
  const offers = [];
  const seenVendors = new Set();

  titleLinks.forEach((tLink, idx) => {
    // Traverse up to find the full card container containing stats and links
    let card = tLink;
    while (card && card.parentElement && card.parentElement.tagName !== 'BODY') {
      if (card.innerText && card.innerText.includes('View Sales Page') && card.innerText.includes('Avg $ Per Conv')) {
        break;
      }
      card = card.parentElement;
    }
    if (!card) return;

    // Extract vendor and clickUrl from offer-details query params
    const hashPart = tLink.href.split('#')[1] || '';
    const queryPart = hashPart.split('?')[1] || '';
    const urlParams = new URLSearchParams(queryPart);
    const vendor = (urlParams.get('offer') || '').trim();
    const clickUrl = decodeURIComponent(urlParams.get('clickUrl') || ('https://hop.clickbank.net/?affiliate=YOUR_AFFILIATE&vendor=' + vendor));

    if (!vendor || seenVendors.has(vendor)) return;
    seenVendors.add(vendor);

    const allLinks = Array.from(card.querySelectorAll('a'));
    const affLink = allLinks.find(a => a.innerText.trim() === 'View Affiliate Page');
    const salesLink = allLinks.find(a => a.innerText.trim() === 'View Sales Page');
    const emailLink = allLinks.find(a => a.href && a.href.toLowerCase().startsWith('mailto:'));
    const telegramLink = allLinks.find(a => a.href && a.href.includes('t.me'));

    const catLinks = allLinks.filter(a => a.href && a.href.includes('#/results?category='));
    const category = catLinks.map(c => c.innerText.trim()).join(' / ') || 'General';

    const text = card.innerText || '';

    // Description extraction
    const descMatch = text.match(/Description\\s+([\\s\\S]*?)(?=(Get Affiliate Link|View Affiliate Page|View Sales Page|Contact|$))/i);
    const description = descMatch ? descMatch[1].trim() : '';

    // Badges / Attributes
    const badges = [];
    if (text.includes('Approval Required')) badges.push('Approval Required');
    if (text.includes('Direct Tracking Available')) badges.push('Direct Tracking Available');
    if (text.includes('CPA Available')) badges.push('CPA Available');
    if (text.includes('Recurring Billing')) badges.push('Recurring Billing');
    if (text.includes('Mobile Friendly')) badges.push('Mobile Friendly');

    // Metrics parsing
    const gravMatch = text.match(/Gravity\\s+([0-9.]+)/i);
    const gravity = gravMatch ? parseFloat(gravMatch[1]) : 0.0;

    const rankMatch = text.match(/Rank\\s+#?([0-9]+)/i);
    const rank = rankMatch ? parseInt(rankMatch[1], 10) : (idx + 1);

    const cvrMatch = text.match(/CVR\\s+([0-9.]+%)/i);
    const epcMatch = text.match(/EPC\\s+[$]?([0-9.]+)/i);

    const totalMatch = text.match(/Total\\s+[$]?([0-9.]+|-)/i);
    const initialMatch = text.match(/Initial\\s+[$]?([0-9.]+|-)/i);
    const futureMatch = text.match(/Future\\s+[$]?([0-9.]+|-)/i);

    offers.push({
      rank,
      vendor,
      title: tLink.innerText.trim(),
      category,
      gravity,
      cvr: cvrMatch ? cvrMatch[1] : 'N/A',
      epc: epcMatch ? ('$' + epcMatch[1]) : 'N/A',
      avg_payout: (totalMatch && totalMatch[1] !== '-') ? parseFloat(totalMatch[1]) : null,
      initial_payout: (initialMatch && initialMatch[1] !== '-') ? parseFloat(initialMatch[1]) : null,
      rebill_payout: (futureMatch && futureMatch[1] !== '-') ? parseFloat(futureMatch[1]) : null,
      sales_page_url: salesLink ? salesLink.href : clickUrl,
      affiliate_tools_url: affLink ? affLink.href : null,
      contact_email: emailLink ? emailLink.href.replace(/^mailto:\\s*/i, '').trim() : null,
      contact_telegram: telegramLink ? telegramLink.href : null,
      badges,
      description
    });
  });

  return offers;
})()`;

async function main() {
  const args = process.argv.slice(2);
  let maxPages = 5; // Default 5 pages = 250 top offers
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pages' && args[i + 1]) {
      maxPages = parseInt(args[++i], 10);
    } else if (args[i] === '--all') {
      maxPages = 25;
    }
  }

  console.log(`========================================================================`);
  console.log(` 🛍️ CLICKBANK AFFILIATE MARKETPLACE MULTI-PAGE BROWSER SCRAPER`);
  console.log(` Target: Active Chrome browser session on port ${CDP_PORT}`);
  console.log(` Target Pages: Up to ${maxPages} pages (${maxPages * 50} offers max)`);
  console.log(`========================================================================\n`);

  const tab = await findClickBankTab();
  if (!tab) {
    console.error("Error: Could not find ClickBank Marketplace tab in Chrome.");
    process.exit(1);
  }

  console.log(`Found active tab: "${tab.title}"`);
  console.log(`URL: ${tab.url}\n`);

  const client = new CDPClient(tab.webSocketDebuggerUrl);
  await client.connect();
  console.log(`Connected to Chrome DevTools Protocol successfully.\n`);

  // First, ensure we start from page 1 (offset=0)
  console.log(`Resetting view to Page 1 (offset=0)...`);
  await client.evaluate(`(() => {
    window.location.hash = '#/results?sortField=rank&sortDescending=false&resultsPerPage=50&offset=0';
  })()`);
  await sleep(2500);

  const allOffers = [];
  const globalSeenVendors = new Set();

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const offset = (pageNum - 1) * 50;
    console.log(`\n------------------------------------------------------------------------`);
    console.log(`[Page ${pageNum}/${maxPages}] Scraping offset ${offset}...`);

    if (pageNum > 1) {
      await client.evaluate(`(() => {
        window.location.hash = '#/results?sortField=rank&sortDescending=false&resultsPerPage=50&offset=${offset}';
      })()`);
      await sleep(2200);
    }

    const pageOffers = await client.evaluate(EXTRACT_PAGE_OFFERS_JS);
    if (!pageOffers || pageOffers.length === 0) {
      console.log(`  No offers found on page ${pageNum}. Reached end of marketplace.`);
      break;
    }

    let addedThisPage = 0;
    pageOffers.forEach(o => {
      if (o.vendor && !globalSeenVendors.has(o.vendor)) {
        globalSeenVendors.add(o.vendor);
        allOffers.push(o);
        addedThisPage++;
      }
    });

    console.log(`  Extracted ${pageOffers.length} offers on this page (${addedThisPage} new). Total collected: ${allOffers.length}`);
    const lastOffer = pageOffers[pageOffers.length - 1];
    if (lastOffer) {
      console.log(`  Current lowest gravity on page: ${lastOffer.gravity} (Offer: ${lastOffer.title.substring(0, 35)}...)`);
    }

    // If gravity drops to 0 across the entire page, stop
    const hasActiveGravity = pageOffers.some(o => o.gravity > 0.5);
    if (!hasActiveGravity && pageNum >= 5) {
      console.log(`  Gravity dropped below 0.5 across all offers on page. Ending crawl.`);
      break;
    }
  }

  client.close();

  // Sort overall results by gravity descending
  allOffers.sort((a, b) => (b.gravity || 0) - (a.gravity || 0));

  // Re-rank 1..N based on gravity
  allOffers.forEach((o, i) => {
    o.marketplace_rank = o.rank;
    o.gravity_rank = i + 1;
  });

  // 1. Export JSON
  const jsonPath = path.resolve(__dirname, 'clickbank_marketplace_full.json');
  fs.writeFileSync(jsonPath, JSON.stringify(allOffers, null, 2), 'utf8');
  console.log(`\n✅ Saved ${allOffers.length} offers to JSON: ${jsonPath}`);

  // 2. Export CSV
  const csvHeaders = [
    'Gravity Rank',
    'Marketplace Rank',
    'Vendor Code',
    'Title',
    'Category',
    'Gravity',
    'CVR',
    'EPC',
    'Avg Payout ($)',
    'Initial Payout ($)',
    'Rebill Payout ($)',
    'Sales Page URL',
    'Affiliate Tools / JV Page',
    'Contact Email',
    'Contact Telegram',
    'Badges',
    'Description'
  ];

  const csvRows = allOffers.map(o => [
    o.gravity_rank,
    o.marketplace_rank,
    `"${(o.vendor || '').replace(/"/g, '""')}"`,
    `"${(o.title || '').replace(/"/g, '""')}"`,
    `"${(o.category || '').replace(/"/g, '""')}"`,
    o.gravity || 0,
    `"${o.cvr || ''}"`,
    `"${o.epc || ''}"`,
    o.avg_payout !== null ? o.avg_payout : '',
    o.initial_payout !== null ? o.initial_payout : '',
    o.rebill_payout !== null ? o.rebill_payout : '',
    `"${(o.sales_page_url || '').replace(/"/g, '""')}"`,
    `"${(o.affiliate_tools_url || '').replace(/"/g, '""')}"`,
    `"${(o.contact_email || '').replace(/"/g, '""')}"`,
    `"${(o.contact_telegram || '').replace(/"/g, '""')}"`,
    `"${(o.badges || []).join(', ')}"`,
    `"${(o.description || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`
  ].join(','));

  const csvContent = [csvHeaders.join(','), ...csvRows].join('\n');
  const csvPath = path.resolve(__dirname, 'clickbank_marketplace_full.csv');
  fs.writeFileSync(csvPath, csvContent, 'utf8');
  console.log(`✅ Saved ${allOffers.length} offers to CSV:  ${csvPath}`);

  // 3. Export Markdown Dossier
  let mdContent = `# ClickBank Marketplace Master Offers Dossier\n\n`;
  mdContent += `*Total Offers Extracted: ${allOffers.length}*\n`;
  mdContent += `*Extracted At: ${new Date().toISOString()}*\n`;
  mdContent += `*Source: Live ClickBank Master Dashboard Affiliate Marketplace*\n\n`;
  mdContent += `| # | Vendor | Product Title | Category | Gravity | Avg $/Conv | CVR | EPC | Sales Page | Affiliate JV Page | Contact |\n`;
  mdContent += `|:---:|:---|:---|:---|:---:|:---:|:---:|:---:|:---|:---|:---|\n`;

  allOffers.forEach(o => {
    const salesLink = o.sales_page_url ? `[Sales Page](${o.sales_page_url})` : 'N/A';
    const affLink = o.affiliate_tools_url ? `[Affiliate JV](${o.affiliate_tools_url})` : 'N/A';
    const contact = o.contact_email ? `[\`${o.contact_email}\`](mailto:${o.contact_email})` : (o.contact_telegram ? `[Telegram](${o.contact_telegram})` : 'N/A');
    const avg = o.avg_payout !== null ? `$${o.avg_payout.toFixed(2)}` : 'N/A';
    mdContent += `| **${o.gravity_rank}** | \`${o.vendor}\` | ${o.title.replace(/\|/g, '-')} | ${o.category.replace(/\|/g, '-')} | **${o.gravity}** | ${avg} | ${o.cvr} | ${o.epc} | ${salesLink} | ${affLink} | ${contact} |\n`;
  });

  const mdPath = path.resolve(__dirname, 'clickbank_marketplace_full.md');
  fs.writeFileSync(mdPath, mdContent, 'utf8');
  console.log(`✅ Saved ${allOffers.length} offers to Markdown: ${mdPath}\n`);

  console.log(`========================================================================`);
  console.log(` 🎉 EXTRACTION COMPLETE! Successfully captured all ${allOffers.length} offers,`);
  console.log(`    merchant sales pages, affiliate JV pages, emails, and live stats!`);
  console.log(`========================================================================\n`);
}

main().catch(err => {
  console.error("Fatal error during ClickBank extraction:", err);
  process.exit(1);
});
