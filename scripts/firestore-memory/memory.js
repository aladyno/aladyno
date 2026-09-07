// Memory CRUD over Firestore (project dzungdo-brain, collection "memory").
// Usage:
//   node memory.js add <slug> <type>        (reads JSON {"description","content"} from stdin)
//   node memory.js list
//   node memory.js get <slug>
//   node memory.js search <query...>
//   node memory.js delete <slug>
//
// type: user | feedback | project | reference

const path = require("path");
const admin = require("firebase-admin");

const keyPath = process.env.KEY_PATH || path.join(__dirname, "key.json");
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
}
const db = admin.firestore();
const col = db.collection("memory");

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function add(slug, type) {
  const raw = await readStdin();
  const { description, content } = JSON.parse(raw);
  const now = new Date().toISOString();
  const existing = await col.doc(slug).get();
  await col.doc(slug).set({
    name: slug,
    type,
    description,
    content,
    createdAt: existing.exists ? existing.data().createdAt : now,
    updatedAt: now,
  });
  console.log(`Saved: ${slug}`);
}

async function list() {
  const snap = await col.orderBy("updatedAt", "desc").get();
  if (snap.empty) return console.log("(empty)");
  snap.forEach((doc) => {
    const d = doc.data();
    console.log(`- [${d.type}] ${d.name} — ${d.description}`);
  });
}

async function get(slug) {
  const doc = await col.doc(slug).get();
  if (!doc.exists) return console.log("Not found:", slug);
  console.log(JSON.stringify(doc.data(), null, 2));
}

async function search(query) {
  const snap = await col.get();
  const q = query.toLowerCase();
  const hits = [];
  snap.forEach((doc) => {
    const d = doc.data();
    const hay = `${d.name} ${d.description} ${d.content}`.toLowerCase();
    if (hay.includes(q)) hits.push(d);
  });
  if (!hits.length) return console.log("No match.");
  hits.forEach((d) => console.log(`- [${d.type}] ${d.name} — ${d.description}`));
}

async function del(slug) {
  await col.doc(slug).delete();
  console.log("Deleted:", slug);
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  if (cmd === "add") await add(rest[0], rest[1]);
  else if (cmd === "list") await list();
  else if (cmd === "get") await get(rest[0]);
  else if (cmd === "search") await search(rest.join(" "));
  else if (cmd === "delete") await del(rest[0]);
  else console.log("Usage: node memory.js <add|list|get|search|delete> ...");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
