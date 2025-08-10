// server.mjs — 단일 파일 완성본

import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

// ── 경로/환경 설정
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
dotenv.config();

const app = express();
app.use(cors());

// ── 환경변수
const PORT      = Number(process.env.PORT || 3000);

// (선택) HA: 있으면 먼저 시도, 없으면 ST로 폴백
const HA_BASE   = process.env.HA_BASE || "";             // 예: http://192.168.x.x:8123
const HA_TOKEN  = process.env.HA_TOKEN || "";
const ENTITY_ID = process.env.ENTITY_ID || "climate.eeokeon";
const ROOM      = process.env.ROOM || "거실";
const NAME      = process.env.NAME || "거실 에어컨";

// SmartThings
const ST_TOKEN  = process.env.SMARTTHINGS_TOKEN || "";

// ── 부팅 로그
console.log(">>> server.mjs running");
console.log("    __dirname:", __dirname);
console.log("    static root:", path.join(__dirname, "public"));
console.log("    PORT:", PORT);
if (!ST_TOKEN) console.warn("⚠️  SMARTTHINGS_TOKEN이 .env에 비어 있음 (ST 폴백 불가)");

// ── 정적 파일 서빙
app.use(express.static(path.join(__dirname, "public")));

// ── 헬스체크/디버그
app.get("/hello", (_req, res) => res.send("hi from " + __dirname));
app.get("/api/ping", (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));

// ── HA 단건(raw) 보기(선택)
app.get("/api/raw", async (_req, res) => {
  try {
    if (!HA_BASE || !HA_TOKEN) return res.status(400).json({ error: "HA not configured" });
    const r = await fetch(`${HA_BASE}/api/states/${ENTITY_ID}`, {
      headers: { Authorization: `Bearer ${HA_TOKEN}` },
    });
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json(j);
    res.json(j);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── 핵심: /api/rooms (HA 있으면 먼저, 없으면 ST로 폴백)
app.get("/api/rooms", async (_req, res) => {
  try {
    // 1) HA 먼저 시도 (환경변수 3종이 모두 있을 때만)
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
            tempSet: j.attributes?.temperature ?? null,
            tempCur: j.attributes?.current_temperature ?? null,
            updatedAt: new Date().toISOString(),
          }];
          return res.json(out);
        }
        // HA 응답 실패 시 ST 폴백
      } catch (_) {
        // HA 호출 에러 → ST 폴백
      }
    }

    // 2) SmartThings 폴백 (또는 단독 사용)
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

    // 프론트가 기대하는 리스트 형태로 최소 필드 매핑
    const devices = (data.items || []).map(d => ({
      id: d.deviceId,
      type: "ac", // 필요시 d.profile?.name 등에 맞춰 조정
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

// ── SmartThings 장치 목록 스냅샷 (진단용)
app.get('/api/st/snapshot', async (_req, res) => {
  try {
    if (!ST_TOKEN) {
      return res.status(500).json({ error: 'SMARTTHINGS_TOKEN missing in .env' });
    }
    const r = await fetch('https://api.smartthings.com/v1/devices', {
      headers: { Authorization: `Bearer ${ST_TOKEN}` }
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

// ── SPA fallback: /api 제외 모든 경로는 index.html
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── start
app.listen(PORT, () => console.log(`✅ listening http://localhost:${PORT}`));
