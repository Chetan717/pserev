const express = require("express");
const cors = require("cors");
const Razorpay = require("razorpay");
const { v4: uuidv4 } = require("uuid");

const app = express();

// ── CORS ───────────────────────────────────────────────────────────────────────
// Allowed origins — add your frontend URLs to ALLOWED_ORIGINS env var (comma-separated)
// Leave ALLOWED_ORIGINS set to allow ALL origins (open API)
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : "*";

app.use(
  cors({
    origin: [
      "https://app.mlmlive.in",
      "http://localhost:5173",
      "http://10.52.22.157:5173",
    ], // * or specific domains
    methods: ["GET", "POST", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Api-Key"],
    optionsSuccessStatus: 204, // handle preflight
  }),
);

app.use(express.json());

// ── Razorpay Instance ──────────────────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ── API Key Validator ──────────────────────────────────────────────────────────
const isValidApiKey = (key) => {
  const validKeys = (process.env.VALID_API_KEYS || "").split(",").map((k) => k.trim());
  return validKeys.includes(key);
};

// ── Health Check ───────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Razorpay Order Service is running" });
});

// ── Create Order ───────────────────────────────────────────────────────────────
// POST /api/create-order?API_KEY=your_key
// Body: { "amount": 500 }   ← amount in INR (will be multiplied by 100 for paise)
app.post("/", async (req, res) => {
  try {
    // 1. Validate API key from query param
    const apiKey = req.query.API_KEY;
    if (!apiKey || !isValidApiKey(apiKey)) {
      return res.status(403).json({ success: false, error: "Invalid API key" });
    }

    // 2. Validate request body
    const { amount } = req.body;
    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid or missing amount" });
    }

    // 3. Create Razorpay order
    const order = await razorpay.orders.create({
      amount: Math.round(Number(amount) * 100), // convert INR → paise
      currency: "INR",
      receipt: uuidv4(),
    });

    // 4. Return order details
    return res.status(200).json({
      success: true,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
    });
  } catch (error) {
    console.error("Razorpay order creation failed:", error);
    return res.status(500).json({
      success: false,
      error: "Error creating Razorpay order",
    });
  }
});

// ── 404 Handler ────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

// ── Start (for local dev) ──────────────────────────────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
