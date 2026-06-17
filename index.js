const express   = require("express");
const cors      = require("cors");
const Razorpay  = require("razorpay");
const { v4: uuidv4 } = require("uuid");
const crypto    = require("crypto");
const rateLimit = require("express-rate-limit");
const helmet    = require("helmet");
const admin     = require("firebase-admin");

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
} catch (err) {
  console.error("Firebase Admin init failed:", err.message);
}

// ── Express setup ────────────────────────────────────────────────────────────
const app = express();
app.use(helmet());

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [];

app.use(cors({
  origin: allowedOrigins,
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Api-Key", "Authorization"],
  optionsSuccessStatus: 204,
}));

app.use(express.json({ limit: "10kb" }));

// ── Rate limiters ────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many requests. Try again later." },
});
app.use(globalLimiter);

// Tighter limiter specifically for coupon validation (prevents brute-force)
const couponLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many coupon attempts. Try again in 15 minutes." },
});

// ── Razorpay ─────────────────────────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const MIN_AMOUNT_INR = 1;
const MAX_AMOUNT_INR = 5000;

// ── Helpers ──────────────────────────────────────────────────────────────────
const getApiKey = (req) => {
  const fromHeader = req.headers["x-api-key"];
  if (fromHeader) return fromHeader.trim();
  const auth = req.headers["authorization"] || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return null;
};

const isValidApiKey = (key) => {
  if (!key) return false;
  const validKeys = (process.env.VALID_API_KEYS || "")
    .split(",").map((k) => k.trim()).filter(Boolean);
  return validKeys.includes(key);
};

const requireApiKey = (req, res, next) => {
  const apiKey = getApiKey(req);
  if (!isValidApiKey(apiKey)) {
    return res.status(403).json({ success: false, error: "Forbidden" });
  }
  next();
};

// ── Routes ───────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Create Razorpay order
app.post("/", requireApiKey, async (req, res) => {
  try {
    const rawAmount = req.body?.amount;
    const amount = Number(rawAmount);
    if (rawAmount === undefined || rawAmount === null || isNaN(amount) ||
        amount < MIN_AMOUNT_INR || amount > MAX_AMOUNT_INR) {
      return res.status(400).json({
        success: false,
        error: `Amount must be between ₹${MIN_AMOUNT_INR} and ₹${MAX_AMOUNT_INR}`,
      });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: uuidv4(),
    });

    return res.status(200).json({
      success:   true,
      order_id:  order.id,
      amount:    order.amount,
      currency:  order.currency,
    });
  } catch (error) {
    console.error("Order creation failed:", error.message);
    return res.status(500).json({ success: false, error: "Order creation failed" });
  }
});

// Verify Razorpay payment signature
app.post("/verify-payment", requireApiKey, (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature ||
        typeof razorpay_order_id   !== "string" ||
        typeof razorpay_payment_id !== "string" ||
        typeof razorpay_signature  !== "string") {
      return res.status(400).json({ success: false, error: "Missing or invalid payment fields" });
    }

    const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSig = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(payload)
      .digest("hex");

    let isValid = false;
    try {
      const receivedBuf = Buffer.from(razorpay_signature, "hex");
      const expectedBuf = Buffer.from(expectedSig, "hex");
      isValid =
        receivedBuf.length === expectedBuf.length &&
        crypto.timingSafeEqual(receivedBuf, expectedBuf);
    } catch { isValid = false; }

    if (!isValid) {
      return res.status(400).json({ success: false, error: "Payment signature verification failed" });
    }

    return res.status(200).json({ success: true, verified: true });
  } catch (error) {
    console.error("Verify payment error:", error.message);
    return res.status(500).json({ success: false, error: "Verification error" });
  }
});

// ── Coupon validation (server-side, never exposed to browser) ────────────────
//
// POST /validate-coupon
// Headers: X-Api-Key: <key>
// Body:    { "code": "ABC123" }
//
// Response (valid):   { success: true, valid: true, discountPercent: 20 }
// Response (invalid): { success: true, valid: false, reason: "not_found" | "inactive" }
// Response (error):   { success: false, error: "..." }
//
app.post("/validate-coupon", requireApiKey, couponLimiter, async (req, res) => {
  if (!db) {
    return res.status(503).json({ success: false, error: "Coupon service unavailable" });
  }

  const rawCode = req.body?.code;

  // Validate code format before hitting Firestore
  if (typeof rawCode !== "string") {
    return res.status(400).json({ success: false, error: "code must be a string" });
  }
  const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 6) {
    return res.status(400).json({ success: false, error: "Coupon code must be exactly 6 alphanumeric characters" });
  }

  try {
    const snap = await db
      .collection("couponcode")
      .where("code", "==", code)
      .limit(1)
      .get();

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

    return res.status(200).json({
      success:         true,
      valid:           true,
      discountPercent,
    });
  } catch (err) {
    console.error("Coupon validation error:", err.message);
    return res.status(500).json({ success: false, error: "Coupon validation failed" });
  }
});

app.use((_req, res) => res.status(404).json({ success: false, error: "Not found" }));

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
