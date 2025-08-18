// server.mjs — SmartThings만 사용 (LG ThinQ는 ST에 연결 서비스로 연동)

import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

dotenv.config();

const app  = express();
const PORT = Number(process.env.PORT || 3000);

// SmartThings 토큰 필수
const ST_TOKEN = process.env.SMARTTHINGS_TOKEN || "";

// ── 부팅 로그
console.log(">>> server.mjs (ST-only) running");
console.log("    __dirname:", __dirname);
console.log("    static root:", path.join(__dirname, "public"));
console.log("    PORT:", PORT);
if (!ST_TOKEN) console.warn("⚠️  SMARTTHINGS_TOKEN이 비어 있습니다 (.env 확인 필요)");

// ── 미들웨어 & 정적 파일
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// ── 유틸: ST API 호출
const stFetch = async (pathRel, init = {}) => {
  const r = await fetch(`https://api.smartthings.com${pathRel}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ST_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  return r;
};

// ── 헬스체크
app.get("/api/ping", (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));
app.get("/hello", (_req, res) => res.send("hi from " + __dirname));

// ── ST: 기기 목록(간단 스냅샷)
app.get("/api/st/snapshot", async (_req, res) => {
  try {
    if (!ST_TOKEN) return res.status(500).json({ error: "SMARTTHINGS_TOKEN missing in .env" });
    const r = await stFetch("/v1/devices");
    const text = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: "devices fetch failed", detail: text });
    const data = JSON.parse(text);
    const items = Array.isArray(data.items) ? data.items : [];
    const devices = items.map(d => ({
      id: d.deviceId,
      name: d.label || d.name,
      room: d.room?.name || "",
      type: d.profile?.name || d.ocf?.deviceType || "device",
    }));
    res.json({ ok: true, devices, fetchedAt: new Date().toISOString() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

// ── 핵심: /api/rooms
//  - ST에서 기기 목록을 받고
//  - 각 기기의 status를 조회해 프런트가 쓰는 형태로 맵핑
app.get("/api/rooms", async (_req, res) => {
  try {
    if (!ST_TOKEN) return res.status(500).json({ error: "SMARTTHINGS_TOKEN missing in .env" });

    // 1) 목록
    const rList = await stFetch("/v1/devices");
    const listText = await rList.text();
    if (!rList.ok) return res.status(rList.status).json({ error: "devices fetch failed", detail: listText });
    const list = JSON.parse(listText);
    const items = Array.isArray(list.items) ? list.items : [];

    // 2) 상태 병합 (병렬로 가져오되 과도한 동시성은 피함)
    const limit = 5; // 동시 요청 제한
    const chunks = [];
    for (let i = 0; i < items.length; i += limit) chunks.push(items.slice(i, i + limit));

    const results = [];
    for (const chunk of chunks) {
      const part = await Promise.all(chunk.map(async d => {
        try {
          const r = await stFetch(`/v1/devices/${d.deviceId}/status`);
          const sText = await r.text();
          if (!r.ok) return null;
          const status = JSON.parse(sText);

          // ── capability 안전 접근
          const m = status?.components?.main || {};
          const sw   = m.switch?.switch?.value; // 'on' | 'off'
          const mode = m.airConditionerMode?.airConditionerMode?.value
                    || m.thermostatMode?.thermostatMode?.value
                    || m.operationMode?.value;

          const tempCur = m.temperatureMeasurement?.temperature?.value;
          const tempSet = m.thermostatCoolingSetpoint?.coolingSetpoint?.value
                       ?? m.thermostatSetpoint?.thermostatSetpoint?.value;

          // 타입 추정(대충): 에어컨이면 airConditionerMode가 있음
          const type = m.airConditionerMode ? "ac"
                      : (m.airPurifierFanMode || m.dustSensor ? "purifier" : "device");

          return {
            id: d.deviceId,
            type,
            name: d.label || d.name,
            room: d.room?.name || "",
            power: sw === "on",
            mode: mode || undefined,
            tempSet: (typeof tempSet === "number") ? tempSet : undefined,
            tempCur: (typeof tempCur === "number") ? tempCur : undefined,
            updatedAt: new Date().toISOString(),
          };
        } catch (_e) {
          return null;
        }
      }));
      results.push(...part.filter(Boolean));
    }

    // 3) 응답 (프런트는 배열을 기대)
    return res.json(results);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e) });
  }
});

// ── SPA fallback: /api 제외한 모든 라우트는 index.html
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`✅ listening http://localhost:${PORT}`));
