/**
 * Cloud Functions entry. HTTP handlers live in routes/; shared helpers in lib/.
 */
const { buildAffiliateUrl } = require("./config");
const { sendMetaCapiEvent } = require("./lib/capi");
const quiz = require("./routes/quiz");
const affiliate = require("./routes/affiliate");
const whatsapp = require("./routes/whatsapp");
const esimCatalog = require("./routes/esim_catalog");

exports.getIpTelemetry = quiz.getIpTelemetry;
exports.trackQuizEvent = quiz.trackQuizEvent;
exports.nordVpnWebhook = quiz.nordVpnWebhook;
exports.onConversionCreated = quiz.onConversionCreated;
exports.affiliateRedirect = affiliate.affiliateRedirect;
exports.completeConnectionScan = whatsapp.completeConnectionScan;
exports.getConnectionScan = whatsapp.getConnectionScan;
exports.whatsappWebhook = whatsapp.whatsappWebhook;
exports.syncEsimCatalog = esimCatalog.syncEsimCatalog;
exports.syncEsimCatalogHttp = esimCatalog.syncEsimCatalogHttp;

exports.handleConversionCreated = quiz.handleConversionCreated;
exports.sendMetaCapiEvent = sendMetaCapiEvent;
exports.buildAffiliateUrl = buildAffiliateUrl;
exports.buildScanCompletedEvent = whatsapp.buildScanCompletedEvent;
exports.sendAgentEvent = whatsapp.sendAgentEvent;
exports.sendWhatsAppText = whatsapp.sendWhatsAppText;
exports.sendOfferCtaCard = whatsapp.sendOfferCtaCard;
exports.offerCtaImage = whatsapp.offerCtaImage;
exports.storeWaMessage = whatsapp.storeWaMessage;
exports.extractAdContext = whatsapp.extractAdContext;
