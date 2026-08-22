/**
 * Report Generator for Daily CTWA Evaluation Harness
 * Ascendant Labs / ScaleDM
 */

const fs = require('fs');
const path = require('path');

function formatReportMarkdown({
  dateLabel,
  aggregatedData,
  evaluationContent,
  accountInfo,
}) {
  const s = aggregatedData.summary;
  const variants = aggregatedData.variants;
  const obj = aggregatedData.objectionTaxonomy;

  let report = `# 📊 CTWA Ad × Meta Business AI Daily Evaluation Brief (${dateLabel})\n\n`;
  report += `**Account**: ${accountInfo.name || 'Ascendant Labs'} (\`${accountInfo.id || 'N/A'}\`) | **Generated**: ${new Date().toISOString()}\n\n`;

  report += `## 🎯 1. Funnel Executive Dashboard\n\n`;
  report += `| Metric | Value |\n`;
  report += `| :--- | :--- |\n`;
  report += `| **Total Ad Spend** | $${s.totalSpend.toFixed(2)} |\n`;
  report += `| **Total Impressions** | ${s.totalImpressions.toLocaleString()} |\n`;
  report += `| **Overall CTR** | ${s.overallCtr}% |\n`;
  report += `| **Link Clicks to WhatsApp** | ${s.totalLinkClicks.toLocaleString()} (CPC: $${s.overallCpc}) |\n`;
  report += `| **Meta Convs Started** | ${s.totalMetaConvs} |\n`;
  report += `| **Firestore Recorded Chats** | ${s.totalFirestoreConvs} (Cost/Chat: $${s.overallCostPerChat}) |\n`;
  report += `| **Connection Scans Run** | ${s.totalScans} (${s.totalFirestoreConvs > 0 ? ((s.totalScans / s.totalFirestoreConvs) * 100).toFixed(1) : 0}% of chats) |\n`;
  report += `| **Tracked CTA Cards Sent** | ${s.totalCtaSent} (${s.totalFirestoreConvs > 0 ? ((s.totalCtaSent / s.totalFirestoreConvs) * 100).toFixed(1) : 0}% of chats) |\n`;
  report += `| **Recorded Purchases** | ${s.totalPurchases} |\n\n`;

  report += `## 🎨 2. Ad Creative & Variant Performance Matrix\n\n`;
  if (variants.length === 0) {
    report += `*No active ad variants recorded in this timeframe.*\n\n`;
  } else {
    report += `| Variant / Ad Name | Spend | CTR | Cost/Conv | Chats | Scan Rate | CTA Rate | Purchases |\n`;
    report += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
    variants.forEach((v) => {
      const spend = (v.spend || 0).toFixed(2);
      const ctr = (v.ctr || 0).toFixed(2);
      const costPerConv = (v.costPerConvStarted || 0).toFixed(2);
      const scanRate = v.funnelRates && v.funnelRates.chatToScanRate != null ? v.funnelRates.chatToScanRate : 0;
      const ctaRate = v.funnelRates && v.funnelRates.chatToCtaRate != null ? v.funnelRates.chatToCtaRate : 0;
      report += `| **${v.adName}** | ${spend} | ${ctr}% | ${costPerConv} | ${v.firestoreChats || 0} | ${scanRate}% | ${ctaRate}% | ${v.purchases || 0} |\n`;
    });
    report += `\n`;
  }

  report += `## 🛑 3. Objection & Drop-Off Taxonomy\n\n`;
  const objKeys = Object.keys(obj);
  if (objKeys.length === 0) {
    report += `*No objections classified in this timeframe.*\n\n`;
  } else {
    report += `| Drop-off / Objection Category | Conversations | % of Total |\n`;
    report += `| :--- | :--- | :--- |\n`;
    objKeys.forEach((k) => {
      const pct = s.totalFirestoreConvs > 0 ? ((obj[k] / s.totalFirestoreConvs) * 100).toFixed(1) : '0.0';
      report += `| \`${k}\` | ${obj[k]} | ${pct}% |\n`;
    });
    report += `\n`;
  }

  report += `## 🔬 4. Strategic Evaluation & AI Recommendations\n\n`;
  report += `${evaluationContent}\n\n`;

  report += `---\n*Generated autonomously by Ascendant Labs CTWA Daily Harness*\n`;

  return report;
}

function saveReport(reportMarkdown, dateLabel, outputDir = 'ads/reports') {
  const targetDir = path.resolve(__dirname, '../../', outputDir);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const safeDate = dateLabel.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `daily_eval_${safeDate}.md`;
  const filepath = path.join(targetDir, filename);

  fs.writeFileSync(filepath, reportMarkdown, 'utf8');
  return filepath;
}

function printConsoleSummary(aggregatedData, reportPath) {
  const s = aggregatedData.summary;
  console.log('\n' + '='.repeat(60));
  console.log('  🚀 CTWA AD × WHATSAPP AGENT DAILY EVALUATION COMPLETE');
  console.log('='.repeat(60));
  console.log(`  💰 Total Spend:       $${s.totalSpend.toFixed(2)}`);
  console.log(`  📱 Link Clicks:       ${s.totalLinkClicks} (CPC: $${s.overallCpc})`);
  console.log(`  💬 WhatsApp Chats:    ${s.totalFirestoreConvs} (Cost/Chat: $${s.overallCostPerChat})`);
  console.log(`  ⚡ Diagnostic Scans:  ${s.totalScans} (${s.totalFirestoreConvs > 0 ? ((s.totalScans / s.totalFirestoreConvs) * 100).toFixed(1) : 0}%)`);
  console.log(`  💳 Product CTAs Sent: ${s.totalCtaSent} (${s.totalFirestoreConvs > 0 ? ((s.totalCtaSent / s.totalFirestoreConvs) * 100).toFixed(1) : 0}%)`);
  console.log(`  🎉 Purchases:         ${s.totalPurchases}`);
  console.log('-'.repeat(60));
  console.log(`  📝 Full Brief Saved: ${reportPath}`);
  console.log('='.repeat(60) + '\n');
}

module.exports = {
  formatReportMarkdown,
  saveReport,
  printConsoleSummary,
};
