#!/usr/bin/env node
/**
 * Daily Closed-Loop Evaluation Harness for Ad x Meta Business AI WhatsApp Agent
 * Ascendant Labs / ScaleDM
 *
 * Usage:
 *   node ads/daily_harness.js
 *   node ads/daily_harness.js --days=1
 *   node ads/daily_harness.js --date-preset=yesterday
 *   node ads/daily_harness.js --date-preset=last_7d --campaign="Nord"
 *   node ads/daily_harness.js --dry-run
 */

const fs = require('fs');
const path = require('path');
const { fetchAccountAdMetrics, DEFAULT_ACCOUNT_ID } = require('./lib/meta_insights_client');
const { fetchWhatsAppConversations } = require('./lib/firestore_chat_extractor');
const { aggregateFunnelData } = require('./lib/funnel_metrics_aggregator');
const { evaluateLoopPerformance } = require('./lib/llm_evaluator');
const {
  formatReportMarkdown,
  saveReport,
  printConsoleSummary,
} = require('./lib/report_generator');

function parseArgs() {
  const args = process.argv.slice(2);
  const DEFAULT_CAMPAIGN_ID = '120250184135160517';
  const options = {
    accountId: DEFAULT_ACCOUNT_ID,
    days: 1,
    datePreset: null,
    campaignFilter: DEFAULT_CAMPAIGN_ID,
    outputDir: 'ads/reports',
    dryRun: false,
    saveJson: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--days=')) {
      options.days = parseInt(arg.split('=')[1], 10) || 1;
    } else if (arg === '--days' && args[i + 1]) {
      options.days = parseInt(args[++i], 10) || 1;
    } else if (arg.startsWith('--date-preset=')) {
      options.datePreset = arg.split('=')[1];
    } else if (arg === '--date-preset' && args[i + 1]) {
      options.datePreset = args[++i];
    } else if (arg.startsWith('--campaign=')) {
      options.campaignFilter = arg.split('=')[1];
    } else if (arg === '--campaign' && args[i + 1]) {
      options.campaignFilter = args[++i];
    } else if (arg.startsWith('--account=')) {
      options.accountId = arg.split('=')[1];
    } else if (arg === '--account' && args[i + 1]) {
      options.accountId = args[++i];
    } else if (arg.startsWith('--output-dir=')) {
      options.outputDir = arg.split('=')[1];
    } else if (arg === '--all-campaigns') {
      options.campaignFilter = null;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--save-json') {
      options.saveJson = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    }
  }

  if (!options.datePreset) {
    options.datePreset = options.days === 1 ? 'yesterday' : `last_${options.days}d`;
  } else if (!process.argv.some(a => a.startsWith('--days'))) {
    const match = options.datePreset.match(/last_(\d+)d/);
    if (match) {
      options.days = parseInt(match[1], 10);
    } else if (options.datePreset === 'maximum') {
      options.days = 180;
    } else if (options.datePreset === 'today') {
      options.days = 1;
    } else if (options.datePreset === 'yesterday') {
      options.days = 2;
    }
  }

  return options;
}

async function runDailyHarness() {
  const options = parseArgs();
  console.log('='.repeat(60));
  console.log(' 🚀 RUNNING AD × META BUSINESS AI DAILY HARNESS');
  console.log(` Target Account: ${options.accountId}`);
  console.log(` Date Window:    ${options.datePreset} (${options.days} day(s))`);
  if (options.campaignFilter) console.log(` Campaign Filter: ${options.campaignFilter}`);
  console.log('='.repeat(60) + '\n');

  // 1. Fetch Meta Ads performance and creative metadata
  console.log('📡 Step 1/4: Fetching Meta Marketing API ad insights and creatives...');
  const metaResults = await fetchAccountAdMetrics({
    accountId: options.accountId,
    datePreset: options.datePreset,
    campaignFilter: options.campaignFilter,
  });
  console.log(`   ✓ Retrieved ${metaResults.campaigns.length} campaign(s) and ${Object.keys(metaResults.adsMap).length} ad(s).\n`);

  // 2. Fetch Firestore WhatsApp chats and scan diagnostics
  const sinceDate = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000);
  console.log(`💬 Step 2/4: Fetching Firestore WhatsApp conversations since ${sinceDate.toISOString().slice(0, 10)}...`);
  const conversations = await fetchWhatsAppConversations({
    sinceDate,
    untilDate: new Date(),
    limit: 500,
  });
  console.log(`   ✓ Retrieved ${conversations.length} conversation(s) from Firestore.\n`);

  // 3. Aggregate Funnel and Classify Objections
  console.log('⚙️ Step 3/4: Joining Ad attribution and classifying conversational drop-offs...');
  const aggregatedData = aggregateFunnelData(metaResults, conversations);
  console.log(`   ✓ Aggregated ${aggregatedData.variants.length} ad variant(s) and classified ${Object.keys(aggregatedData.objectionTaxonomy).length} objection bucket(s).\n`);

  if (options.saveJson) {
    const jsonPath = path.resolve(__dirname, `../ads/reports/daily_eval_${options.datePreset}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(aggregatedData, null, 2), 'utf8');
    console.log(`   ✓ Saved raw JSON dataset to ${jsonPath}`);
  }

  // 4. Run Multi-Layer Evaluation
  console.log('🔬 Step 4/4: Running multi-layer strategic evaluation...');
  const evaluationContent = await evaluateLoopPerformance(aggregatedData);

  // Generate Report
  const dateLabel = `${options.datePreset}_${new Date().toISOString().slice(0, 10)}`;
  const markdownReport = formatReportMarkdown({
    dateLabel,
    aggregatedData,
    evaluationContent,
    accountInfo: metaResults.account,
  });

  if (!options.dryRun) {
    const reportPath = saveReport(markdownReport, dateLabel, options.outputDir);
    printConsoleSummary(aggregatedData, reportPath);
  } else {
    console.log('\n[DRY RUN] Generated Markdown Brief:\n');
    console.log(markdownReport);
  }
}

runDailyHarness().catch((err) => {
  console.error('\n❌ Error running daily harness:', err);
  process.exit(1);
});
