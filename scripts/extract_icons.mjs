// Extrai os ícones (base64) do baygon-backup-latest.json para public/.
// Uso: node scripts/extract_icons.mjs
import fs from "node:fs";
import path from "node:path";

const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const backup = JSON.parse(fs.readFileSync(path.join(root, "baygon-backup-latest.json"), "utf8"));

const pubGuilds = path.join(root, "public", "guilds");
fs.mkdirSync(pubGuilds, { recursive: true });

function salvar(dataUrl, dest) {
  const b64 = String(dataUrl).replace(/^data:image\/\w+;base64,/, "");
  const buf = Buffer.from(b64, "base64");
  fs.writeFileSync(dest, buf);
  return buf.length;
}

const alvos = [
  [backup.mascotBase64, path.join(root, "public", "mascot.png")],
  [backup.guildIcons?.Manicomio, path.join(pubGuilds, "manicomio.png")],
  [backup.guildIcons?.Resonance, path.join(pubGuilds, "resonance.png")],
];
for (const [data, dest] of alvos) {
  if (!data) { console.log("AUSENTE:", dest); continue; }
  const n = salvar(data, dest);
  console.log("ok:", path.relative(root, dest), "(" + n + " bytes)");
}
