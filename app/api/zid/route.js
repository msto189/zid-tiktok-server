export const runtime = "nodejs";

import crypto from "crypto";

const TIKTOK_ENDPOINT = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

// TikTok عادة يتوقع البريد lowercased + trimmed قبل الهاش
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePhone(phone) {
  // نخليها نص فقط ونحذف المسافات
  return String(phone || "").trim();
}

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function normalizeCurrency(x) {
  const s = String(x || "").trim().toUpperCase();
  return s.length === 3 ? s : "SAR";
}

export async function GET() {
  return Response.json({ ok: true, message: "Zid webhook endpoint ready", path: "/api/zid" });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function POST(req) {
  try {
    const raw = await req.json().catch(() => ({}));

    const testEventCode = raw?.test_event_code || null;
    const event = raw?.event || "Purchase";

    const event_id = raw?.event_id ? String(raw.event_id) : `evt-${Date.now()}`;

    const value = toNumber(raw?.value ?? 0);
    const currency = normalizeCurrency(raw?.currency ?? "SAR");

    const storeUrl = process.env.STORE_URL || "https://tokotoysa.com/";
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    const ua = req.headers.get("user-agent") || "";

    // ✅ نقرأ البريد/الهاتف من البودي (ممكن "" من GTM)
    const emailRaw = normalizeEmail(raw?.user?.email ?? "");
    const phoneRaw = normalizePhone(raw?.user?.phone ?? "");

    // ✅ حسب توصية TikTok: مرر "" عندما لا تكون متاحة
    const emailHashedOrEmpty = emailRaw ? sha256Hex(emailRaw) : "";
    const phoneHashedOrEmpty = phoneRaw ? sha256Hex(phoneRaw) : "";

    const body = {
      event_source: "web",
      event_source_id: process.env.TIKTOK_PIXEL_ID,
      test_event_code: testEventCode || undefined,
      data: [
        {
          event,
          event_time: Math.floor(Date.now() / 1000),
          event_id,
          user: {
            ip: ip || "",
            user_agent: ua || "",
            email: emailHashedOrEmpty,        // "" أو sha256
            phone_number: phoneHashedOrEmpty, // "" أو sha256
          },
          page: { url: storeUrl },
          properties: {
            currency,
            value,
          },
        },
      ],
    };

    const res = await fetch(TIKTOK_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": process.env.TIKTOK_ACCESS_TOKEN,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    return Response.json(
      {
        ok: true,
        sent: {
          event,
          event_id,
          value,
          currency,
          email_sent: emailHashedOrEmpty ? "sha256" : "",
          phone_sent: phoneHashedOrEmpty ? "sha256" : "",
          test_event_code: testEventCode || "",
        },
        tiktok: data,
        http_status: res.status,
      },
      { headers }
    );
  } catch (err) {
    return Response.json(
      { ok: false, error: String(err) },
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      }
    );
  }
}
