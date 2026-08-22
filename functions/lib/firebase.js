const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

admin.initializeApp();
const db = admin.firestore();
const esimDb = getFirestore(admin.app(), process.env.ESIM_FIRESTORE_DATABASE || "esim");
esimDb.settings({ ignoreUndefinedProperties: true });

module.exports = { admin, db, esimDb };
