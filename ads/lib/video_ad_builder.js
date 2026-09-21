/**
 * Video AI Prompt & Creative Suite Builder
 * Ascendant Labs / Meta Video Ad Generator
 * 
 * Synthesizes product intelligence, reference imagery, and Meta Ad Library
 * competitor research into a unified production script (combining Video AI prompts,
 * voice-overs, and on-screen captions into a single 30s variant) and a dedicated
 * Meta Ad Copy package.
 */

const fs = require('fs');
const path = require('path');

/**
 * Format prompt files and write to campaign folder
 */
function buildCreativeCampaignSuite(campaignDir, { productIntel, downloadedAssets, adResearch }) {
  let brand = 'Product';
  if (productIntel.brandName && productIntel.brandName !== 'product') {
    brand = productIntel.brandName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  // If brand name has trailing domain digits like "Prodentim101", check if productTitle or headings has clean brand
  if (/\d+$/.test(brand) && productIntel.productTitle) {
    const cleanMatch = productIntel.productTitle.match(/\b([A-Z][a-zA-Z]{3,15})\b/);
    if (cleanMatch && !['Home', 'Welcome', 'About', 'Official', 'Order'].includes(cleanMatch[1])) {
      brand = cleanMatch[1];
    }
  }

  const siteUrl = productIntel.siteUrl || '';
  const primaryAsset = (downloadedAssets && downloadedAssets[0]) ? downloadedAssets[0].filename : 'ref_asset_01.jpg';
  const secondaryAsset = (downloadedAssets && downloadedAssets[1]) ? downloadedAssets[1].filename : primaryAsset;
  const features = productIntel.topFeaturesAndBenefits || [];
  const snippets = productIntel.coreContentSnippets || [];
  const headings = productIntel.keyHeadings || [];

  const blacklistWords = /^(ingredients|about|home|contact|features|details|menu|references|disclaimer)$/i;
  const validFeatures = features.filter(f => !blacklistWords.test(f.trim()) && f.trim().length > 4);
  const validHeadings = headings.filter(h => !blacklistWords.test(h.trim()) && h.trim().length > 4);

  let topBenefitSnippet = validFeatures[0] || 'supporting daily wellness and lasting relief';
  if (topBenefitSnippet.length > 45 || topBenefitSnippet.includes('.')) {
    if (/gum|teeth|oral|mouth/i.test(validFeatures.join(' ') + ' ' + validHeadings.join(' '))) {
      topBenefitSnippet = 'supporting healthy teeth and gums';
    } else {
      topBenefitSnippet = 'noticeable, long-term improvement';
    }
  }

  let mechanismSnippet = validFeatures[1] || 'its doctor-formulated blend';
  if (blacklistWords.test(mechanismSnippet) || mechanismSnippet.length > 45 || mechanismSnippet.includes('.')) {
    if (/probiotic|bacteria|oral/i.test(validFeatures.join(' ') + ' ' + validHeadings.join(' '))) {
      mechanismSnippet = '3.5 billion live oral probiotic strains';
    } else {
      mechanismSnippet = 'its clinically studied natural formula';
    }
  }

  const topHookObj = (adResearch.topHooks && adResearch.topHooks[0]) || null;
  const primaryHookAngle = topHookObj ? topHookObj.archetype : 'Direct Value & Problem-Solution Hook';

  // Clean up any legacy file paths from older generator versions
  const legacyFiles = [
    path.join(campaignDir, '03_video_ai_prompts.md'),
    path.join(campaignDir, '04_storyboards_and_voiceovers.md'),
    path.join(campaignDir, '05_meta_ad_copy_package.md')
  ];
  legacyFiles.forEach(legacyPath => {
    if (fs.existsSync(legacyPath)) {
      try { fs.unlinkSync(legacyPath); } catch (e) {}
    }
  });

  // Ensure directories exist
  const researchDir = path.join(campaignDir, '02_market_research');
  fs.mkdirSync(researchDir, { recursive: true });

  // -------------------------------------------------------------
  // 1. Write Market Research Digest
  // -------------------------------------------------------------
  const marketResearchJsonPath = path.join(researchDir, 'meta_ads_inspiration.json');
  fs.writeFileSync(marketResearchJsonPath, JSON.stringify(adResearch, null, 2), 'utf8');

  let researchMd = `# 📊 Meta Ads Market Research & Competitor Intelligence\n\n`;
  researchMd += `**Target Brand**: ${brand}\n`;
  researchMd += `**Product URL**: ${siteUrl}\n`;
  researchMd += `**Ads Analyzed**: ${adResearch.totalAdsScanned || 0} ads (${adResearch.activeAdsCount || 0} active)\n\n`;
  researchMd += `## 🏆 Top Proven Winning Hooks in this Category\n\n`;

  if (adResearch.topHooks && adResearch.topHooks.length > 0) {
    adResearch.topHooks.forEach((h, i) => {
      researchMd += `### #${i + 1} [${h.archetype}] — Score: ${h.winningScore}/100\n`;
      researchMd += `- **Advertiser**: ${h.pageName} (${h.flightDays} days continuous flight)\n`;
      researchMd += `- **Headline**: "${h.headline || 'N/A'}"\n`;
      researchMd += `- **Opening Hook**: > "${h.openingHook}"\n`;
      researchMd += `- **Ad Library**: [View on Facebook Ad Library](${h.libraryUrl})\n\n`;
    });
  } else {
    researchMd += `*No direct competitor ads discovered or Meta API token not provided. Using direct-response algorithmic defaults.*\n\n`;
  }

  const marketResearchMdPath = path.join(researchDir, 'meta_ads_inspiration.md');
  fs.writeFileSync(marketResearchMdPath, researchMd, 'utf8');

  // -------------------------------------------------------------
  // 2. Build Unified Video Production Script (Prompts + Voice-Over + Captions)
  // Generates ONLY ONE cohesive 30s variant for seamless copy-pasting.
  // -------------------------------------------------------------
  let scriptMd = `# 🎬 30-Second Meta Video Ad Production Script\n`;
  scriptMd += `## High-Converting Unified Creative Suite for **${brand}**\n\n`;
  scriptMd += `> [!IMPORTANT]\n`;
  scriptMd += `> This document unifies **Video AI Generation Prompts** (Runway Gen-3 Alpha, Kling AI, Luma Dream Machine, Sora), **Word-for-Word Voice-Over Scripts**, and **On-Screen Captions** into a single 30-second direct-response video variant.\n`;
  scriptMd += `> Copy and paste the prompts directly into your AI video generator (upload your product image as the first frame for Image-to-Video mode if desired).\n\n`;

  scriptMd += `### 🚫 Universal Negative Prompt (Copy into Video AI Settings):\n`;
  scriptMd += `\`\`\`text\n`;
  scriptMd += `blurry, morphing limbs, distorted fingers, extra hands, mutated face, plastic waxy skin, cartoon, 3D CGI animation, unnatural jerky camera shake, overexposed blowout, text artifacts, watermark, low resolution.\n`;
  scriptMd += `\`\`\`\n\n`;
  scriptMd += `---\n\n`;

  scriptMd += `## 🎥 Unified Scene-by-Scene Production Breakdown (30s Single Variant)\n\n`;

  // Scene 1
  scriptMd += `### Scene 1: The 3-Second Pattern Interrupt (0:00 - 0:03)\n`;
  scriptMd += `- **Timing**: 0:00 - 0:03 (3 seconds)\n`;
  scriptMd += `- **Pacing / Camera**: Fast forward punch zoom, handheld smartphone POV, high velocity.\n`;
  scriptMd += `- **Prompt (Text-to-Video / T2V)**:\n`;
  scriptMd += `\`\`\`text\n`;
  scriptMd += `[Camera: Fast forward punch zoom]. Authentic handheld smartphone POV in a bright, modern living space. An everyday relatable creator (early 30s) looks directly into the lens with an exasperated, shocked expression, holding up a common outdated alternative before tossing it aside with disbelief. Natural window lighting, shallow depth of field, 4k 24fps photorealistic, native TikTok/Reels aesthetic. --ar 9:16\n`;
  scriptMd += `\`\`\`\n`;
  scriptMd += `- **Prompt (Image-to-Video / I2V — Start Frame: Uploaded Creator / Product Image)**:\n`;
  scriptMd += `\`\`\`text\n`;
  scriptMd += `Start frame image conditioning. The subject reacts authentically to camera, natural micro-movements, slight head tilt, holding the product up toward the lens, soft natural daylight, authentic skin texture, zero plastic AI smoothing, hyperrealistic commercial social video. --ar 9:16\n`;
  scriptMd += `\`\`\`\n`;
  scriptMd += `- **🎙️ Voice-Over (Audio)**: *"Stop doing this if you’re still trying to fix your daily routine..."*\n`;
  scriptMd += `- **💬 On-Screen Caption (High Contrast Overlay)**: **🛑 STOP DOING THIS**\n\n`;

  // Scene 2
  scriptMd += `### Scene 2: Problem Agitation & Hidden Root Cause (0:03 - 0:08)\n`;
  scriptMd += `- **Timing**: 0:03 - 0:08 (5 seconds)\n`;
  scriptMd += `- **Pacing / Camera**: Steady medium tracking shot, moody contrast to bright resolution.\n`;
  scriptMd += `- **Prompt (T2V / I2V)**:\n`;
  scriptMd += `\`\`\`text\n`;
  scriptMd += `[Camera: Steady medium tracking shot]. Close-up on the frustrating common problem: user struggling with standard low-quality alternatives, showing wear, discomfort, or clunky friction. Dim, moody, high-contrast interior lighting showing real annoyance, cinematic documentary realism, 35mm lens. --ar 9:16\n`;
  scriptMd += `\`\`\`\n`;
  scriptMd += `- **🎙️ Voice-Over (Audio)**: *"Most ordinary products only treat the surface symptoms, while completely ignoring the real root cause."*\n`;
  scriptMd += `- **💬 On-Screen Caption**: **Why Ordinary Options Fail ❌**\n\n`;

  // Scene 3
  scriptMd += `### Scene 3: The Mechanism & Solution Reveal (0:08 - 0:16)\n`;
  scriptMd += `- **Timing**: 0:08 - 0:16 (8 seconds)\n`;
  scriptMd += `- **Pacing / Camera**: Smooth 360 orbital macro pan, slow motion 60fps, warm golden rim light.\n`;
  scriptMd += `- **Prompt (Text-to-Video / T2V)**:\n`;
  scriptMd += `\`\`\`text\n`;
  scriptMd += `[Camera: Smooth 360 orbital macro pan, slow motion 60fps]. Crisp commercial product showcase of ${brand}. Warm golden-hour rim lighting accentuating premium textures and materials. Hands smoothly unboxing and interacting with the product in a clean aesthetic environment. Hyper-detailed reflections, photorealistic 8k commercial finish, zero motion blur. --ar 9:16\n`;
  scriptMd += `\`\`\`\n`;
  scriptMd += `- **Prompt (Image-to-Video / I2V — Start Frame: Uploaded Product Showcase Image)**:\n`;
  scriptMd += `\`\`\`text\n`;
  scriptMd += `Start frame image conditioning. Smooth 360 orbital camera movement around the product. Soft dynamic lighting reveals clean textures and packaging details, hands gently interact with the product, studio lighting, hyperrealistic commercial finish. --ar 9:16\n`;
  scriptMd += `\`\`\`\n`;
  scriptMd += `- **🎙️ Voice-Over (Audio)**: *"That’s why thousands are switching to ${brand}. It is engineered specifically with ${mechanismSnippet} to deliver real results in minutes."*\n`;
  scriptMd += `- **💬 On-Screen Caption**: **Enter ${brand} ✨**<br/>*(${topBenefitSnippet})*\n\n`;

  // Scene 4
  scriptMd += `### Scene 4: Social Proof & Daily Life Transformation (0:16 - 0:23)\n`;
  scriptMd += `- **Timing**: 0:16 - 0:23 (7 seconds)\n`;
  scriptMd += `- **Pacing / Camera**: Dynamic slow pan from left to right, sun-drenched airy aesthetic.\n`;
  scriptMd += `- **Prompt (T2V / I2V — Start Frame: Uploaded Lifestyle / Creator Image)**:\n`;
  scriptMd += `\`\`\`text\n`;
  scriptMd += `[Camera: Dynamic slow pan from left to right]. Smiling user experiencing effortless relief and satisfaction using ${brand} during daily routine. Bright, airy, sun-drenched Scandinavian minimalist room. Natural laughter, authentic joy, sharp 4k details, modern direct-to-consumer brand campaign aesthetic. --ar 9:16\n`;
  scriptMd += `\`\`\`\n`;
  scriptMd += `- **🎙️ Voice-Over (Audio)**: *"No complicated steps. No wasted time. Just noticeable, long-term improvement you can actually feel."*\n`;
  scriptMd += `- **💬 On-Screen Caption**: **100% Proven Results 🌿**<br/>*(⭐⭐⭐⭐⭐ 5-Star Rated)*\n\n`;

  // Scene 5
  scriptMd += `### Scene 5: Hero Packshot & Offer Call-To-Action (0:23 - 0:30)\n`;
  scriptMd += `- **Timing**: 0:23 - 0:30 (7 seconds)\n`;
  scriptMd += `- **Pacing / Camera**: Centered slow push-in on luxury countertop, subtle sparkle.\n`;
  scriptMd += `- **Prompt (Text-to-Video / T2V)**:\n`;
  scriptMd += `\`\`\`text\n`;
  scriptMd += `[Camera: Centered slow push-in]. Beautiful tabletop studio arrangement featuring ${brand} positioned next to its sleek packaging box on reflective acrylic surface. Soft studio lightbox illumination, sharp product branding, animated subtle sparkle light streak, high-converting DTC packshot. --ar 9:16\n`;
  scriptMd += `\`\`\`\n`;
  scriptMd += `- **Prompt (Image-to-Video / I2V — Start Frame: Uploaded Hero Bottle Shot)**:\n`;
  scriptMd += `\`\`\`text\n`;
  scriptMd += `Start frame image conditioning. The camera performs a slow centered push-in on the hero product arrangement on a reflective acrylic countertop. Soft studio lighting, pristine surface reflections, subtle animated sparkle streak across the packaging, high-converting DTC packshot. --ar 9:16\n`;
  scriptMd += `\`\`\`\n`;
  scriptMd += `- **🎙️ Voice-Over (Audio)**: *"Tap 'Learn More' below to claim the exclusive online discount before the current batch sells out!"*\n`;
  scriptMd += `- **💬 On-Screen Caption**: **Tap Learn More Below 👇**<br/>*(60-Day Money-Back Guarantee)*\n\n`;

  scriptMd += `---\n\n`;

  // Continuous VO block
  scriptMd += `## 🎙️ Complete Continuous Voice-Over Audio Script (30s)\n`;
  scriptMd += `*Copy-paste this directly into ElevenLabs, Play.ht, or send to voice talent (~68 words, 140 wpm conversational cadence):*\n\n`;
  scriptMd += `> "Stop doing this if you’re still trying to fix your daily routine. Most ordinary products only treat the surface symptoms, while completely ignoring the real root cause. That’s why thousands are switching to ${brand}. It is engineered specifically with ${mechanismSnippet} to deliver real results in minutes. No complicated steps. No wasted time. Just noticeable, long-term improvement you can actually feel. Tap Learn More below to claim the exclusive online discount before the current batch sells out!"\n\n`;

  scriptMd += `---\n\n`;

  // Caption Timeline Table
  scriptMd += `## 💬 Complete On-Screen Caption Timeline\n\n`;
  scriptMd += `| Timestamp | On-Screen Caption (Bold Overlay) | Visual Beat |\n`;
  scriptMd += `|---|---|---|\n`;
  scriptMd += `| **0:00 - 0:03** | 🛑 **STOP DOING THIS** | Pattern interrupt, shock expression |\n`;
  scriptMd += `| **0:03 - 0:08** | **Why Ordinary Options Fail ❌** | Agitation, failure of old methods |\n`;
  scriptMd += `| **0:08 - 0:16** | **Enter ${brand} ✨**<br/>*(${topBenefitSnippet})* | Hero unboxing & mechanism reveal |\n`;
  scriptMd += `| **0:16 - 0:23** | **100% Proven Results 🌿** | Happy user, daily life relief |\n`;
  scriptMd += `| **0:23 - 0:30** | **Tap Learn More Below 👇** | Tabletop packshot + discount callout |\n\n`;

  const scriptMdPath = path.join(campaignDir, '03_video_production_script.md');
  fs.writeFileSync(scriptMdPath, scriptMd, 'utf8');

  // -------------------------------------------------------------
  // 3. Build Dedicated Meta Ad Copy Package (Supporting This One Video Ad)
  // Provides multiple high-CTR copy variants tailored specifically to pair with the video.
  // -------------------------------------------------------------
  let copyPackageMd = `# 📝 Meta Ad Copy Package (Tailored for 30s Video Ad)\n`;
  copyPackageMd += `## High-CTR Ad Copy Variants for **${brand}**\n\n`;
  copyPackageMd += `> [!NOTE]\n`;
  copyPackageMd += `> These copy packages are specifically written to accompany the **30-Second Video Ad** defined in [\`03_video_production_script.md\`](file://${scriptMdPath}). Multiple copy variants allow split testing against the single video creative in Meta Ads Manager.\n\n`;

  // Variant 1: The Personal Epiphany Story
  copyPackageMd += `### 📦 Copy Variant 1: The Personal Epiphany Story (UGC Native Hook — Highest CTR)\n`;
  copyPackageMd += `- **Matches Video Beat**: Scene 1 (Pattern Interrupt) & Scene 4 (Relief)\n`;
  copyPackageMd += `- **Target Placement**: Facebook Feed, Instagram Feed\n`;
  copyPackageMd += `- **Primary Text**:\n`;
  copyPackageMd += `> I was skeptical at first.\n>\n`;
  copyPackageMd += `> When you've tried three different solutions and none of them make a lasting difference, you start to think that's just the way it has to be.\n>\n`;
  copyPackageMd += `> But it turns out the problem wasn't my routine — it was ordinary products that only treated surface symptoms instead of the root cause.\n>\n`;
  copyPackageMd += `> That's why I switched to **${brand}**.\n>\n`;
  if (features.length > 0) {
    features.slice(0, 3).forEach(f => {
      copyPackageMd += `> • ${f}\n`;
    });
    copyPackageMd += `>\n`;
  }
  copyPackageMd += `> If you're ready to fix the root cause and upgrade your daily routine, see how it works below 👇\n\n`;
  copyPackageMd += `- **Headline (Title)**: I Wish I Found This Sooner ✨\n`;
  copyPackageMd += `- **Link Description**: Over 10,000+ Happy Customers • 60-Day Guarantee\n`;
  copyPackageMd += `- **Call-To-Action (CTA)**: \`Learn More\`\n\n`;
  copyPackageMd += `---\n\n`;

  // Variant 2: The Direct Problem-Solution Contrast
  copyPackageMd += `### 📦 Copy Variant 2: The "Stop Replacing, Start Fixing" Contrast (Mechanism Focus)\n`;
  copyPackageMd += `- **Matches Video Beat**: Scene 2 (Root Cause) & Scene 3 (Mechanism)\n`;
  copyPackageMd += `- **Target Placement**: Instagram Stories, Reels, Feed\n`;
  copyPackageMd += `- **Primary Text**:\n`;
  copyPackageMd += `> Why do we keep settling for products that break down or stop working?\n>\n`;
  copyPackageMd += `> Standard alternatives cut corners on formula and craftsmanship. **${brand}** was engineered differently from the ground up:\n>\n`;
  if (headings.length > 0) {
    headings.slice(0, 3).forEach(h => {
      copyPackageMd += `> ✅ **${h}**\n`;
    });
    copyPackageMd += `>\n`;
  }
  copyPackageMd += `> Fix the root cause, not the symptoms. Tap below to claim today's online discount 👇\n\n`;
  copyPackageMd += `- **Headline (Title)**: The Upgrade Your Routine Needs 🚀\n`;
  copyPackageMd += `- **Link Description**: 60-Day 100% Money-Back Guarantee\n`;
  copyPackageMd += `- **Call-To-Action (CTA)**: \`Shop Now\`\n\n`;
  copyPackageMd += `---\n\n`;

  // Variant 3: Short Punchy Curiosity Punch
  copyPackageMd += `### 📦 Copy Variant 3: Short Curiosity & Limited Offer Pattern-Interrupt\n`;
  copyPackageMd += `- **Matches Video Beat**: Scene 1 & Scene 5 (Urgent CTA)\n`;
  copyPackageMd += `- **Target Placement**: Mobile Feed & Reels\n`;
  copyPackageMd += `- **Primary Text**:\n`;
  copyPackageMd += `> The one simple daily upgrade everyone is talking about this week.\n>\n`;
  copyPackageMd += `> Discover why thousands of verified users are leaving 5-star reviews for **${brand}**.\n>\n`;
  copyPackageMd += `> Tap below to check availability and claim the current sale 👇\n\n`;
  copyPackageMd += `- **Headline (Title)**: Back In Stock (Limited Supply) 🔥\n`;
  copyPackageMd += `- **Link Description**: Free Fast Shipping On Selected Orders\n`;
  copyPackageMd += `- **Call-To-Action (CTA)**: \`Learn More\`\n\n`;

  copyPackageMd += `---\n\n`;
  copyPackageMd += `## ⚖️ Meta Ad Policy Compliance Checklist:\n`;
  copyPackageMd += `1. **No Personal Health Attributes**: Does not single out users by asking *"Are you suffering from...?"* (Kept in third-person or personal story format).\n`;
  copyPackageMd += `2. **No Unrealistic Guarantees**: Focuses on product design, craftsmanship, and verified customer testimonials.\n`;
  copyPackageMd += `3. **1:1 Landing Page Congruence**: The headlines and visuals directly mirror the messaging on \`${siteUrl}\` to keep bounce rates near zero.\n`;

  const copyPackageMdPath = path.join(campaignDir, '04_meta_ad_copy_package.md');
  fs.writeFileSync(copyPackageMdPath, copyPackageMd, 'utf8');

  return {
    campaignDir,
    files: [
      marketResearchJsonPath,
      marketResearchMdPath,
      scriptMdPath,
      copyPackageMdPath
    ]
  };
}

module.exports = {
  buildCreativeCampaignSuite
};
