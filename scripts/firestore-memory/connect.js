// One-off connection test for the "dzungdo-brain" Firestore (Standard edition, asia-southeast1).
// Usage: node connect.js
//
// Requires the service account key downloaded from:
//   Firebase console -> Project settings (gear icon) -> Service accounts -> Generate new private key
// Save it as key.json in this folder (already gitignored) or point KEY_PATH env var to it.

const path = require("path");
const admin = require("firebase-admin");

const keyPath = process.env.KEY_PATH || path.join(__dirname, "key.json");

admin.initializeApp({
  credential: admin.credential.cert(require(keyPath)),
});

const db = admin.firestore();

async function main() {
  const ref = db.collection("memory").doc("_connection_test");
  await ref.set({ ok: true, at: new Date().toISOString() });
  const snap = await ref.get();
  console.log("Write+read OK:", snap.data());
  await ref.delete();
  console.log("Cleanup OK. Connection works.");
}

main().catch((err) => {
  console.error("Connection failed:", err.message);
  process.exit(1);
});
