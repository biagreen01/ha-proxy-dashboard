import express from "express";
import dotenv from "dotenv";
import cors from "cors";

import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

dotenv.config();
const app = express();
app.use(cors());

const HA_BASE   = process.env.HA_BASE || "http://localhost:8123";
const HA_TOKEN  = process.env.HA_TOKEN;
const ENTITY_ID = process.env.ENTITY_ID || "climate.eeokeon";
const ROOM      = process.env.ROOM || "거실";
const NAME      = process.env.NAME || "거실 에어컨";
const PORT      = Number(process.env.PORT || 3000);

// 디버그 로그로 현재 경로/포트 확인
console.log(">>> server.mjs running");
console.log("    __dirname:", __dirname);
console.log("    static root:", path.join(__dirname, "public"));
console.log("    PORT:", PORT);

if (!HA_TOKEN) {
  console.error("❗ .env의 HA_TOKEN이 비어 있습니다.");
  // 여기서 종료되면 곧바로 프롬프트가 돌아옴
  // process.exit(1);
}

// 🔹 public 폴더를 루트(/)로 서비스
app.use(express.static(path.join(__dirname, "public")));

// (디버그용) /hello
app.get("/hello", (_req, res) => res.send("hi from " + __dirname));

const haFetch = async (p) => {
  const res = await fetch(`${HA_BASE}${p}`, {
    headers: { Authorization: `Bearer ${HA_TOKEN}` },
  });
  if (!res.ok) throw new Error(`HA ${p} ${res.status}`);
  return res.json();
};

app.get("/api/ping", (_req, res) => {
  res.json({ ok: true, at: new Date().toISOString() });
});

app.get("/api/raw", async (_req, res) => {
  try { res.json(await haFetch(`/api/states/${ENTITY_ID}`)); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get("/api/rooms", async (_req, res) => {
  try {
    const j = await haFetch(`/api/states/${ENTITY_ID}`);
    const out = [{
      id: ENTITY_ID,
      type: "ac",
      name: NAME,
      room: ROOM,
      power: j.state !== "off",
      mode: j.state,
      tempSet: j.attributes.temperature ?? null,
      tempCur: j.attributes.current_temperature ?? null,
      updatedAt: new Date().toISOString(),
    }];
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// 🔹 SPA fallback: /api 제외 모든 경로는 index.html
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`✅ listening http://localhost:${PORT}`));
