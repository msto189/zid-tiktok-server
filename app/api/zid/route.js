export const runtime = "nodejs";

const TIKTOK_ENDPOINT = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function normalizeCurrency(x) {
  if (!x) return "SAR";
  const s = String(x).trim().toUpperCase();
  return s.length === 3 ? s : "SAR";
}

export async function GET() {
  return Response.json({ ok: true, message: "Zid webhook endpoint ready", path: "/api/zid" });
}

// ✅ مهم لطلبات المتصفح (CORS)
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

    // event_id: لو جاك من GTM أو غيره
    const event_id = raw?.event_id ? String(raw.event_id) : `manual-${Date.now()}`;

    const value = toNumber(raw?.value ?? 0);
    const currency = normalizeCurrency(raw?.currency ?? "SAR");

    const storeUrl = process.env.STORE_URL || "https://tokotoysa.com/";
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    const ua = req.headers.get("user-agent") || "";

    // ✅ صيغة Events API 2.0 (اللي تعتمدها واجهة الاختبار غالبًا)
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
            ip: ip || null,
            user_agent: ua || null,
          },
          page: {
            url: storeUrl,
          },
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

    // CORS headers للمتصفح
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    return Response.json(
      {
        ok: true,
        sent: { event, event_id, value, currency, test_event_code: testEventCode },
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
