export const runtime = "nodejs";

const TIKTOK_ENDPOINT = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

function pick(obj, paths) {
  for (const p of paths) {
    const parts = p.split(".");
    let cur = obj;
    let ok = true;
    for (const k of parts) {
      if (cur && Object.prototype.hasOwnProperty.call(cur, k)) cur = cur[k];
      else { ok = false; break; }
    }
    if (ok && cur !== undefined && cur !== null) return cur;
  }
  return undefined;
}

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function normalizeCurrency(x) {
  if (!x) return "SAR";
  const s = String(x).trim().toUpperCase();
  return s.length === 3 ? s : "SAR";
}

function buildContents(payload) {
  const items =
    pick(payload, ["data.items", "data.products", "order.items", "order.products", "items", "products"]) || [];

  if (!Array.isArray(items)) return [];

  return items.slice(0, 50).map((it) => {
    const id = pick(it, ["sku", "product_sku", "id", "product_id", "variant_id", "sku_id"]) ?? "";
    const name = pick(it, ["name", "product_name", "title"]) ?? "";
    const price = toNumber(pick(it, ["price", "unit_price", "sale_price", "original_price"]));
    const quantity = toNumber(pick(it, ["quantity", "qty", "count"])) || 1;

    return {
      content_id: String(id),
      content_name: String(name),
      content_type: "product",
      price,
      quantity,
    };
  });
}

function mapZidEventToTikTok(eventName) {
  const e = (eventName || "").toLowerCase();

  if (e.includes("payment_status") || e.includes("paid") || e === "purchase") return "Purchase";
  if (e === "order.create" || e.includes("order.create")) return "InitiateCheckout";
  if (e.includes("abandoned_cart")) return "AddToCart";
  if (e.includes("customer.register") || e.includes("register")) return "CompleteRegistration";

  return "CustomEvent";
}

async function sendToTikTok({
  event,
  event_id,
  storeUrl,
  ip,
  ua,
  email,
  phone,
  value,
  currency,
  contents,
  testEventCode, // ✅
}) {
  const body = {
    pixel_code: process.env.TIKTOK_PIXEL_ID,
    event,
    event_id,
    timestamp: Math.floor(Date.now() / 1000),

    // ✅ إذا موجود نخليه يرسل لاختبار الأحداث، إذا غير موجود ما ينرسل
    test_event_code: testEventCode || undefined,

    context: {
      page: { url: storeUrl },
      user: {
        ip: ip || "",
        user_agent: ua || "",
        email: email || null,
        phone_number: phone || null,
      },
    },
    properties: {
      currency: normalizeCurrency(currency),
      value: toNumber(value),
      contents: Array.isArray(contents) ? contents : [],
    },
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
  return { status: res.status, data };
}

export async function GET() {
  return Response.json({ ok: true, message: "Zid webhook endpoint ready", path: "/api/zid" });
}

export async function POST(req) {
  try {
    const raw = await req.json().catch(() => ({}));

    const zidEvent =
      pick(raw, ["event", "event_name", "type", "name"]) ||
      pick(raw, ["meta.event", "meta.event_name"]) ||
      "unknown.event";

    const event = mapZidEventToTikTok(zidEvent);

    const orderId =
      pick(raw, ["ecommerce.transaction_id", "data.id", "data.order_id", "order.id", "order.order_id", "id", "order_id"]) ||
      `${Date.now()}`;

    const value =
      pick(raw, ["ecommerce.value", "data.total", "data.total_amount", "order.total", "order.total_amount", "total", "total_amount"]) ||
      0;

    const currency = pick(raw, ["ecommerce.currency", "data.currency", "order.currency", "currency"]) || "SAR";

    const email =
      pick(raw, ["customer.email", "data.customer.email", "order.customer.email", "email"]) || null;

    const phone =
      pick(raw, ["customer.mobile", "data.customer.mobile", "data.customer.phone", "order.customer.mobile", "customer.mobile", "phone"]) ||
      null;

    const contents = buildContents(raw);

    // ✅ هنا نقرأ رمز الاختبار إذا أرسلته من GTM داخل JSON
    const testEventCode = pick(raw, ["test_event_code"]) || null;

    const ip = req.headers.get("x-forwarded-for") || "";
    const ua = req.headers.get("user-agent") || "";

    const event_id = `${event}:${orderId}`;
    const storeUrl = process.env.STORE_URL || "https://tokotoysa.com/";

    const tiktok = await sendToTikTok({
      event,
      event_id,
      storeUrl,
      ip,
      ua,
      email,
      phone,
      value,
      currency,
      contents,
      testEventCode, // ✅
    });

    return Response.json({ ok: true, zid_event: zidEvent, tiktok_event: event, event_id, test_event_code: testEventCode, tiktok });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
