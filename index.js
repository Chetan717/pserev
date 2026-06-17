const express   = require("express");
const cors      = require("cors");
const Razorpay  = require("razorpay");
const { v4: uuidv4 } = require("uuid");
const crypto    = require("crypto");
const rateLimit = require("express-rate-limit");
const helmet    = require("helmet");
const admin     = require("firebase-admin");

// ── Firebase Admin ────────────────────────────────────────────────────────────
let db = null;
try {
  if (!admin.apps.length) {
    const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!svcJson) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(svcJson)),
    });
  }
  db = admin.firestore();
  console.log("Firebase Admin initialised");
} catch (err) {
  console.error("Firebase Admin init failed:", err.message);
}

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();

// helmet — but disable contentSecurityPolicy so browser JS calls work fine
app.use(helmet({ contentSecurityPolicy: false }));

// ── CORS ──────────────────────────────────────────────────────────────────────
// Read comma-separated origins from env, e.g.:
//   ALLOWED_ORIGINS=https://app.mlmlive.in,https://www.mlmlive.in
//
// If not set, ALL origins are blocked by default (safe for a pure API server).
// Set ALLOWED_ORIGINS=* in Vercel only during debugging — remove for production.
const rawOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no Origin header (Postman, curl, server-to-server)
    if (!origin) return callback(null, true);

    // Wildcard — allow everything (use only for debugging)
    if (rawOrigins.includes("*")) return callback(null, true);

    if (rawOrigins.includes(origin)) return callback(null, true);

    console.warn("CORS blocked origin:", origin);
    callback(new Error("Not allowed by CORS: " + origin));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Api-Key", "Authorization"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

// Handle preflight for every route
app.options("*", cors(corsOptions));

app.use(express.json({ limit: "10kb" }));

// ── Rate limiters ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many requests. Try again later." },
});
app.use(globalLimiter);

const couponLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many coupon attempts. Try again in 15 minutes." },
});

// ── Razorpay ──────────────────────────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const MIN_AMOUNT_INR = 1;
const MAX_AMOUNT_INR = 50000;

// ── Helpers ───────────────────────────────────────────────────────────────────
const getApiKey = (req) => {
  const h = req.headers["x-api-key"];
  if (h) return h.trim();
  const auth = req.headers["authorization"] || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return null;
};

const isValidApiKey = (key) => {
  if (!key) return false;
  const valid = (process.env.VALID_API_KEYS || "")
    .split(",").map((k) => k.trim()).filter(Boolean);
  return valid.includes(key);
};

const requireApiKey = (req, res, next) => {
  if (!isValidApiKey(getApiKey(req))) {
    return res.status(403).json({ success: false, error: "Forbidden" });
  }
  next();
};

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check — GET (no auth needed, confirms server is alive)
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Root GET — confirms routing works (no auth needed)
app.get("/", (_req, res) =>
  res.json({ status: "ok", message: "Payment service is running" })
);

// ── POST / — Create Razorpay order ───────────────────────────────────────────
app.post("/", requireApiKey, async (req, res) => {
  try {
    const rawAmount = req.body?.amount;
    const amount = Number(rawAmount);

    if (rawAmount === undefined || rawAmount === null ||
        isNaN(amount) || amount < MIN_AMOUNT_INR || amount > MAX_AMOUNT_INR) {
      return res.status(400).json({
        success: false,
        error: `Amount must be between ₹${MIN_AMOUNT_INR} and ₹${MAX_AMOUNT_INR}`,
      });
    }

    const order = await razorpay.orders.create({
      amount:   Math.round(amount * 100),
      currency: "INR",
      receipt:  uuidv4(),
    });

    return res.status(200).json({
      success:  true,
      order_id: order.id,
      amount:   order.amount,
      currency: order.currency,
    });
  } catch (err) {
    console.error("Order creation failed:", err.message);
    return res.status(500).json({ success: false, error: "Order creation failed" });
  }
});

// ── POST /verify-payment — Verify Razorpay signature ─────────────────────────
app.post("/verify-payment", requireApiKey, (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature ||
        typeof razorpay_order_id   !== "string" ||
        typeof razorpay_payment_id !== "string" ||
        typeof razorpay_signature  !== "string") {
      return res.status(400).json({ success: false, error: "Missing or invalid payment fields" });
    }

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    let isValid = false;
    try {
      const a = Buffer.from(razorpay_signature, "hex");
      const b = Buffer.from(expected, "hex");
      isValid = a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch { isValid = false; }

    if (!isValid) {
      return res.status(400).json({ success: false, error: "Payment signature verification failed" });
    }

    return res.status(200).json({ success: true, verified: true });
  } catch (err) {
    console.error("Verify payment error:", err.message);
    return res.status(500).json({ success: false, error: "Verification error" });
  }
});

// ── POST /validate-coupon — Server-side coupon validation ─────────────────────
app.post("/validate-coupon", requireApiKey, couponLimiter, async (req, res) => {
  if (!db) {
    return res.status(503).json({ success: false, error: "Coupon service unavailable" });
  }

  const rawCode = req.body?.code;
  if (typeof rawCode !== "string") {
    return res.status(400).json({ success: false, error: "code must be a string" });
  }

  const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 6) {
    return res.status(400).json({
      success: false,
      error: "Coupon code must be exactly 6 alphanumeric characters",
    });
  }

  try {
    const snap = await db.collection("couponcode").where("code", "==", code).limit(1).get();

    if (snap.empty) {
      return res.status(200).json({ success: true, valid: false, reason: "not_found" });
    }

    const data = snap.docs[0].data();

    if (data.active === false) {
      return res.status(200).json({ success: true, valid: false, reason: "inactive" });
    }

    const discountPercent = Number(data.user_discount ?? 0);
    if (isNaN(discountPercent) || discountPercent < 0 || discountPercent > 100) {
      return res.status(200).json({ success: true, valid: false, reason: "invalid_discount" });
    }

    return res.status(200).json({ success: true, valid: true, discountPercent });
  } catch (err) {
    console.error("Coupon validation error:", err.message);
    return res.status(500).json({ success: false, error: "Coupon validation failed" });
  }
});

// 404 fallback
app.use((_req, res) => res.status(404).json({ success: false, error: "Not found" }));

// ── Start (local dev only; Vercel ignores this) ───────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
