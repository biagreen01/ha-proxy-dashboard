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
    // 1) HA가 사용 가능하면 시도
    if (HA_BASE && HA_TOKEN && ENTITY_ID) {
      try {
        const r = await fetch(`${HA_BASE}/api/states/${ENTITY_ID}`, {
          headers: { Authorization: `Bearer ${HA_TOKEN}` }
        });
        if (r.ok) {
          const j = await r.json();
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
          return res.json(out);
        }
        // HA가 401/500이면 ST로 폴백
      } catch (_) {
        // HA 호출 에러 → ST로 폴백
      }
    }

    // 2) ST 사용 (HA 없거나 실패하면 여기로)
    if (!ST_TOKEN) {
      return res.status(500).json({ error: "SMARTTHINGS_TOKEN missing in .env" });
    }
    const r2 = await fetch("https://api.smartthings.com/v1/devices", {
      headers: { Authorization: `Bearer ${ST_TOKEN}` }
    });
    if (!r2.ok) {
      const txt = await r2.text();
      return res.status(r2.status).json({ error: "SmartThings devices fetch failed", detail: txt });
    }
    const data = await r2.json();
    const devices = (data.items || []).map(d => ({
      id: d.deviceId,
      type: "ac", // 필요시 d.profile?.name 등에 맞춰 매핑
      name: d.label || d.name,
      room: d.room?.name || "",
      power: undefined,
      mode: undefined,
      tempSet: undefined,
      tempCur: undefined,
      updatedAt: new Date().toISOString(),
    }));
    return res.json(devices);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e) });
  }
});
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// 🔹 SPA fallback: /api 제외 모든 경로는 index.html
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
// ── SmartThings snapshot: /api/st/snapshot ─────────────────
import dotenv from 'dotenv';
dotenv.config();

const ST_TOKEN = process.env.SMARTTHINGS_TOKEN;

app.get('/api/st/snapshot', async (req, res) => {
  try {
    if (!ST_TOKEN) {
      return res.status(500).json({ error: 'SMARTTHINGS_TOKEN missing in .env' });
    }
    const r = await fetch('https://api.smartthings.com/v1/devices', {
      headers: { Authorization: 'Bearer ${ST_TOKEN}' }
    });
    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: 'SmartThings devices fetch failed', detail: text });
    }
    const data = await r.json();
    const devices = (data.items || []).map(d => ({
      id: d.deviceId,
      name: d.label || d.name,
      room: (d.room && d.room.name) || '',
      type: (d.ocf && d.ocf.deviceType) || d.profile?.name || 'device',
    }));
    res.json({ ok: true, devices, fetchedAt: new Date().toISOString() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});
app.listen(PORT, () => console.log(`✅ listening http://localhost:${PORT}`));


