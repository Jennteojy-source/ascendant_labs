const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

exports.submitLead = onRequest({ cors: true }, async (req, res) => {
    // Enable CORS
    res.set('Access-Control-Allow-Origin', '*');
    
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'POST');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.set('Access-Control-Max-Age', '3600');
        return res.status(204).send('');
    }

    if (req.method !== "POST") {
        return res.status(405).send("Method Not Allowed");
    }

    const { name, email, website, channel, spend, message } = req.body;

    // Simple Server-Side Input Validation
    if (!name || !email || !website) {
        return res.status(400).json({ 
            success: false, 
            error: "Missing required fields: name, email, website." 
        });
    }

    try {
        // Save lead data into Firestore
        const leadRef = admin.firestore().collection("leads").doc();
        const leadData = {
            id: leadRef.id,
            name: name.trim(),
            email: email.trim().toLowerCase(),
            website: website.trim(),
            channel: channel || 'unspecified',
            spend: spend || 'unspecified',
            message: message ? message.trim() : '',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            source: 'landing_page_audit'
        };

        await leadRef.set(leadData);
        logger.info("New lead captured in Firestore", { leadId: leadRef.id, email: leadData.email });

        // Note: For advanced setups, trigger automated Slack hooks or SendGrid emails here.

        return res.status(200).json({
            success: true,
            message: "Lead recorded successfully.",
            leadId: leadRef.id
        });
    } catch (error) {
        logger.error("Error storing lead in Firestore:", error);
        return res.status(500).json({ 
            success: false, 
            error: "Internal Server Error." 
        });
    }
});
