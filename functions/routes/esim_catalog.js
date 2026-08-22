const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const { config } = require("../config");
const { admin, esimDb } = require("../lib/firebase");
const { listPackages, partitionId, toPackageDoc } = require("../lib/esim_access");

const WRITE_LIMIT = 400;

async function commitBatches(ops) {
  let batch = esimDb.batch();
  let count = 0;
  let committed = 0;
  for (const op of ops) {
    if (op.type === "set") batch.set(op.ref, op.data);
    else if (op.type === "delete") batch.delete(op.ref);
    count += 1;
    if (count >= WRITE_LIMIT) {
      await batch.commit();
      committed += count;
      batch = esimDb.batch();
      count = 0;
    }
  }
  if (count) {
    await batch.commit();
    committed += count;
  }
  return committed;
}

function cutoffPartition(ttlDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - ttlDays);
  return partitionId(d);
}

async function deleteOldPartitions(ttlDays) {
  const cutoff = cutoffPartition(ttlDays);
  const snap = await esimDb.collection("catalogs").get();
  const deleted = [];
  for (const doc of snap.docs) {
    if (doc.id === "current") continue;
    if (doc.id < cutoff) {
      await esimDb.recursiveDelete(doc.ref);
      deleted.push(doc.id);
    }
  }
  return deleted;
}

async function syncCatalog() {
  const syncedAt = FieldValue.serverTimestamp();
  const now = new Date();
  const partition = partitionId(now);
  const ttlDays = config.esimAccess.catalogTtlDays;
  const expireAt = admin.firestore.Timestamp.fromDate(
    new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000)
  );

  const listed = await listPackages({});
  const packages = listed.obj?.packageList || [];
  if (!packages.length) {
    throw new Error("eSIM Access returned an empty catalog");
  }

  const partitionRef = esimDb.collection("catalogs").doc(partition);
  const packageCol = partitionRef.collection("packages");
  const extras = { partition, syncedAt, expireAt };

  const ops = packages.map((pkg) => ({
    type: "set",
    ref: packageCol.doc(String(pkg.packageCode)),
    data: toPackageDoc(pkg, extras),
  }));

  await commitBatches(ops);

  const meta = {
    partition,
    packageCount: packages.length,
    ttlDays,
    syncedAt,
    expireAt,
    source: "esimaccess",
  };
  await partitionRef.set(meta, { merge: true });
  await esimDb.collection("catalogs").doc("current").set(meta, { merge: true });

  const deleted = await deleteOldPartitions(ttlDays);
  return { partition, packageCount: packages.length, deletedPartitions: deleted, ttlDays };
}

const SCHEDULE_OPTS = {
  schedule: "0 2 * * *",
  timeZone: "Asia/Singapore",
  timeoutSeconds: 540,
  memory: "1GiB",
  region: "us-central1",
  secrets: ["ACCESS_CODE"],
};

const syncEsimCatalog = onSchedule(SCHEDULE_OPTS, async () => {
  const result = await syncCatalog();
  console.log("eSIM catalog sync", result);
  return result;
});

const syncEsimCatalogHttp = onRequest(
  { timeoutSeconds: 540, memory: "1GiB", region: "us-central1" },
  async (req, res) => {
    const key = req.get("x-api-key") || req.query.key;
    if (!config.webhookApiKey || key !== config.webhookApiKey) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      const result = await syncCatalog();
      res.status(200).json(result);
    } catch (err) {
      console.error("eSIM catalog sync failed", err);
      res.status(500).json({ error: err.message, payload: err.payload || null });
    }
  }
);

module.exports = { syncEsimCatalog, syncEsimCatalogHttp, syncCatalog };
