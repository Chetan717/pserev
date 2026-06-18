// const express   = require("express");
// const cors      = require("cors");
// const Razorpay  = require("razorpay");
// const { v4: uuidv4 } = require("uuid");
// const crypto    = require("crypto");
// const rateLimit = require("express-rate-limit");
// const helmet    = require("helmet");
// const admin     = require("firebase-admin");

// // ── Firebase Admin ────────────────────────────────────────────────────────────
// let db = null;
// try {
//   if (!admin.apps.length) {
//     const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
//     if (!svcJson) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
//     admin.initializeApp({ credential: admin.credential.cert(JSON.parse(svcJson)) });
//   }
//   db = admin.firestore();
//   console.log("Firebase Admin initialised");
// } catch (err) {
//   console.error("Firebase Admin init failed:", err.message);
// }

// // ── Express ───────────────────────────────────────────────────────────────────
// const app = express();
// app.use(helmet({ contentSecurityPolicy: false }));

// // ── CORS ──────────────────────────────────────────────────────────────────────
// const rawOrigins = (process.env.ALLOWED_ORIGINS || "")
//   .split(",").map((o) => o.trim()).filter(Boolean);

// const corsOptions = {
//   origin(origin, callback) {
//     if (!origin) return callback(null, true);
//     if (rawOrigins.includes("*")) return callback(null, true);
//     if (rawOrigins.includes(origin)) return callback(null, true);
//     console.warn("CORS blocked origin:", origin);
//     callback(new Error("Not allowed by CORS: " + origin));
//   },
//   methods: ["GET", "POST", "OPTIONS"],
//   allowedHeaders: ["Content-Type", "X-Api-Key", "Authorization"],
//   optionsSuccessStatus: 204,
// };
// app.use(cors(corsOptions));
// app.options("*", cors(corsOptions));
// app.use(express.json({ limit: "10kb" }));

// // ── Rate limiters ─────────────────────────────────────────────────────────────
// app.use(rateLimit({
//   windowMs: 15 * 60 * 1000, max: 60,
//   standardHeaders: true, legacyHeaders: false,
//   message: { success: false, error: "Too many requests. Try again later." },
// }));
// const couponLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, max: 10,
//   standardHeaders: true, legacyHeaders: false,
//   message: { success: false, error: "Too many coupon attempts. Try again in 15 minutes." },
// });

// // ── Razorpay ──────────────────────────────────────────────────────────────────
// const razorpay = new Razorpay({
//   key_id:     process.env.RAZORPAY_KEY_ID,
//   key_secret: process.env.RAZORPAY_KEY_SECRET,
// });

// const MIN_AMOUNT_INR = 1;
// const MAX_AMOUNT_INR = 500000;

// // ── Collection names (match your Firestore) ───────────────────────────────────
// // Plans live as an array inside each company document in the mlmcomp collection:
// //   mlmcomp/{companyId} → { Plans: [ { PlanName, PlanAmount, Day_value, … } ] }
// const COL_COMPANY      = process.env.COMPANY_COLLECTION      || "mlmcomp";
// const COL_COUPON       = process.env.COUPON_COLLECTION       || "couponcode";
// const COL_SUBSCRIPTION = process.env.SUBSCRIPTION_COLLECTION || "subscription";
// const COL_PAYMENTLOG   = process.env.PAYMENTLOG_COLLECTION   || "paymentlog";
// const COL_PENDING      = "_pendingOrders"; // internal, never exposed to client

// // ── Helpers ───────────────────────────────────────────────────────────────────
// const getApiKey = (req) => {
//   const h = req.headers["x-api-key"];
//   if (h) return h.trim();
//   const auth = req.headers["authorization"] || "";
//   if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
//   return null;
// };

// const isValidApiKey = (key) => {
//   if (!key) return false;
//   const valid = (process.env.VALID_API_KEYS || "")
//     .split(",").map((k) => k.trim()).filter(Boolean);
//   return valid.includes(key);
// };

// const requireApiKey = (req, res, next) => {
//   if (!isValidApiKey(getApiKey(req))) {
//     return res.status(403).json({ success: false, error: "Forbidden" });
//   }
//   next();
// };

// const requireDb = (req, res, next) => {
//   if (!db) return res.status(503).json({ success: false, error: "Database unavailable" });
//   next();
// };

// const formatDateForDB = (date) =>
//   date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

// // ── Routes ────────────────────────────────────────────────────────────────────

// // Health check
// app.get("/health", (_req, res) => res.json({ status: "ok" }));
// app.get("/",       (_req, res) => res.json({ status: "ok", message: "Payment service is running" }));

// // ── POST / — Create Razorpay order (SECURE: server fetches plan price) ────────
// //
// // Plans are stored as an array inside each mlmcomp document — NOT as separate docs.
// // Data shape: mlmcomp/{companyId} → { Plans: [ { PlanName, PlanAmount, … } ] }
// //
// // Client sends: { companyId, planIndex, couponCode?, userMobile?, userName? }
// // Server:
// //   1. Fetches the mlmcomp doc for companyId
// //   2. Reads Plans[planIndex] — server owns the price, client cannot tamper
// //   3. Validates coupon server-side
// //   4. Calculates amount (discount + GST) server-side
// //   5. Creates Razorpay order
// //   6. Stores a _pendingOrders record for idempotent verification
// //
// app.post("/", requireApiKey, requireDb, async (req, res) => {
//   const { companyId, planName, couponCode, userMobile, userName } = req.body || {};

//   // Validate required fields
//   if (!companyId || typeof companyId !== "string" || companyId.trim().length === 0) {
//     return res.status(400).json({ success: false, error: "companyId is required" });
//   }

//   try {
//     // 1. Fetch the company document from mlmcomp (server controls the price)
//     const compSnap = await db.collection(COL_COMPANY).doc(companyId.trim()).get();
//     if (!compSnap.exists) {
//       return res.status(404).json({ success: false, error: "Company not found" });
//     }
//     const compData = compSnap.data();
//     const plans    = Array.isArray(compData.Plans) ? compData.Plans : [];
    
//     const plan = plans?.filter((i)=>i.PlanName === `${PlanName}`);

//     // Reject plans that are not launched/active
//     if (plan.Launch === false || plan.active === false) {
//       return res.status(400).json({ success: false, error: "This plan is not available for purchase" });
//     }

//     const baseAmt = Number(plan.PlanAmount ?? 0);
//     if (!baseAmt || isNaN(baseAmt) || baseAmt <= 0) {
//       return res.status(400).json({ success: false, error: "Plan has an invalid amount" });
//     }

//     // 2. Validate coupon server-side (server controls the discount — client cannot tamper)
//     let discountPercent   = 0;
//     let appliedCouponCode = null;
//     if (couponCode && typeof couponCode === "string") {
//       const code = couponCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
//       if (code.length === 6) {
//         const cSnap = await db.collection(COL_COUPON).where("code", "==", code).limit(1).get();
//         if (!cSnap.empty) {
//           const cData = cSnap.docs[0].data();
//           if (cData.active !== false) {
//             const pct = Number(cData.user_discount ?? 0);
//             if (!isNaN(pct) && pct >= 0 && pct <= 100) {
//               discountPercent   = pct;
//               appliedCouponCode = code;
//             }
//           }
//         }
//       }
//     }

//     // 3. Calculate final payable amount (server-side only — never trust the client)
//     const discountAmt   = Math.floor((baseAmt * discountPercent) / 100);
//     const afterDiscount = baseAmt - discountAmt;
//     const gstAmt        = Math.round(afterDiscount * 0.18);
//     const payableAmount = afterDiscount + gstAmt;

//     if (payableAmount < MIN_AMOUNT_INR || payableAmount > MAX_AMOUNT_INR) {
//       return res.status(400).json({
//         success: false,
//         error: `Payable amount ₹${payableAmount} is outside the allowed range`,
//       });
//     }

//     // 4. Create Razorpay order (amount is what the server calculated — Razorpay enforces it)
//     const receipt = uuidv4();
//     const order   = await razorpay.orders.create({
//       amount:   Math.round(payableAmount * 100), // Razorpay uses paise
//       currency: "INR",
//       receipt,
//     });

//     // 5. Store pending order — used by /verify-payment to write the subscription
//     const today      = new Date();
//     const expiryDate = new Date(today);
//     expiryDate.setDate(expiryDate.getDate() + (Number(plan.Day_value) || 0));

//     await db.collection(COL_PENDING).doc(order.id).set({
//       orderId:         order.id,
//       companyId,
//       planIndex:       idx,
//       planName:        plan.PlanName || "",
//       planType:        plan.Type     || "",
//       baseAmount:      baseAmt,
//       discountPercent,
//       discountAmount:  discountAmt,
//       couponCode:      appliedCouponCode,
//       gstAmount:       gstAmt,
//       payableAmount,
//       duration:        Number(plan.Day_value)  || 0,
//       downloads:       Number(plan.downloads)  || 0,
//       userMobile:      userMobile || "",
//       userName:        userName   || "",
//       startDate:       today,
//       expiryDate,
//       receipt,
//       processed:       false,
//       createdAt:       admin.firestore.FieldValue.serverTimestamp(),
//     });

//     // 6. Return server-confirmed amounts — client MUST use these for the Razorpay widget
//     return res.status(200).json({
//       success:        true,
//       order_id:       order.id,
//       payableAmount,
//       baseAmount:     baseAmt,
//       discountAmount: discountAmt,
//       discountPercent,
//       gstAmount:      gstAmt,
//       currency:       order.currency,
//       planName:       plan.PlanName || "",
//       expiryDays:     Number(plan.Day_value) || 0,
//     });
//   } catch (err) {
//     console.error("Order creation failed:", err.message);
//     return res.status(500).json({ success: false, error: "Order creation failed" });
//   }
// });

// // ── POST /verify-payment — Verify signature + write subscription (SECURE) ─────
// //
// // BEFORE (vulnerable): browser wrote subscription record to Firestore directly —
// //                      anyone with Firestore access could create free subscriptions.
// // NOW (secure):        server verifies Razorpay signature, then writes the
// //                      subscription using Firebase Admin SDK (bypasses client rules).
// //                      Idempotent: replaying the same orderId returns success without
// //                      creating a duplicate subscription.
// //
// app.post("/verify-payment", requireApiKey, requireDb, async (req, res) => {
//   const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

//   if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature ||
//       typeof razorpay_order_id   !== "string" ||
//       typeof razorpay_payment_id !== "string" ||
//       typeof razorpay_signature  !== "string") {
//     return res.status(400).json({ success: false, error: "Missing or invalid payment fields" });
//   }

//   // 1. Verify Razorpay HMAC signature (timing-safe)
//   const expected = crypto
//     .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
//     .update(`${razorpay_order_id}|${razorpay_payment_id}`)
//     .digest("hex");

//   let isValid = false;
//   try {
//     const a = Buffer.from(razorpay_signature, "hex");
//     const b = Buffer.from(expected, "hex");
//     isValid = a.length === b.length && crypto.timingSafeEqual(a, b);
//   } catch { isValid = false; }

//   if (!isValid) {
//     return res.status(400).json({ success: false, error: "Payment signature verification failed" });
//   }

//   try {
//     // 2. Load the pending order (contains plan details stored at order creation)
//     const pendingRef  = db.collection(COL_PENDING).doc(razorpay_order_id);
//     const pendingSnap = await pendingRef.get();

//     if (!pendingSnap.exists) {
//       // Signature is valid but we have no pending order record.
//       // Return success so the user isn't blocked; subscription won't be written.
//       console.warn("verify-payment: no pending order for", razorpay_order_id);
//       return res.status(200).json({ success: true, verified: true, dbWritten: false });
//     }

//     const pending = pendingSnap.data();

//     // 3. Idempotency — already processed, return success without re-writing
//     if (pending.processed) {
//       return res.status(200).json({ success: true, verified: true, dbWritten: true, idempotent: true });
//     }

//     // 4. Write subscription record using Admin SDK (server controls this — client cannot fake it)
//     const startDate  = pending.startDate?.toDate  ? pending.startDate.toDate()  : new Date();
//     const expiryDate = pending.expiryDate?.toDate ? pending.expiryDate.toDate() : new Date();

//     const subscriptionDoc = {
//       OrderId:             razorpay_order_id,
//       payment:             "Success",
//       plan:                pending.planName,
//       planType:            pending.planType,
//       company:             pending.companyId,
//       startdate:           formatDateForDB(startDate),
//       expirydate:          formatDateForDB(expiryDate),
//       download:            pending.downloads ?? 0,
//       PurchaseAt:          admin.firestore.FieldValue.serverTimestamp(),
//       PaymentAmount:       pending.payableAmount,
//       duration:            pending.duration,
//       mobileNo:            pending.userMobile,
//       UserName:            pending.userName,
//       Active:              true,
//       Expire:              false,
//       UTRID:               razorpay_order_id,
//       razorpay_payment_id,
//       razorpay_order_id,
//       razorpay_signature,
//       couponApplied:       pending.couponCode   || null,
//       discountPercent:     pending.discountPercent ?? 0,
//     };

//     // Write both records in parallel
//     await Promise.all([
//       db.collection(COL_SUBSCRIPTION).add(subscriptionDoc),
//       db.collection(COL_PAYMENTLOG).add(subscriptionDoc).catch(() => {}),
//     ]);

//     // 5. Mark pending order as processed (prevents duplicate subscriptions on retry)
//     await pendingRef.update({
//       processed:       true,
//       processedAt:     admin.firestore.FieldValue.serverTimestamp(),
//       razorpay_payment_id,
//     });

//     return res.status(200).json({ success: true, verified: true, dbWritten: true });
//   } catch (err) {
//     console.error("Verify payment error:", err.message);
//     return res.status(500).json({ success: false, error: "Verification error" });
//   }
// });

// // ── POST /validate-coupon — Coupon check (unchanged, already secure) ──────────
// app.post("/validate-coupon", requireApiKey, couponLimiter, requireDb, async (req, res) => {
//   const rawCode = req.body?.code;
//   if (typeof rawCode !== "string") {
//     return res.status(400).json({ success: false, error: "code must be a string" });
//   }

//   const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
//   if (code.length !== 6) {
//     return res.status(400).json({
//       success: false, error: "Coupon code must be exactly 6 alphanumeric characters",
//     });
//   }

//   try {
//     const snap = await db.collection(COL_COUPON).where("code", "==", code).limit(1).get();
//     if (snap.empty) {
//       return res.status(200).json({ success: true, valid: false, reason: "not_found" });
//     }

//     const data = snap.docs[0].data();
//     if (data.active === false) {
//       return res.status(200).json({ success: true, valid: false, reason: "inactive" });
//     }

//     const discountPercent = Number(data.user_discount ?? 0);
//     if (isNaN(discountPercent) || discountPercent < 0 || discountPercent > 100) {
//       return res.status(200).json({ success: true, valid: false, reason: "invalid_discount" });
//     }

//     return res.status(200).json({ success: true, valid: true, discountPercent });
//   } catch (err) {
//     console.error("Coupon validation error:", err.message);
//     return res.status(500).json({ success: false, error: "Coupon validation failed" });
//   }
// });

// // 404 fallback
// app.use((_req, res) => res.status(404).json({ success: false, error: "Not found" }));

// // ── Start (local dev only — Vercel ignores this) ──────────────────────────────
// if (require.main === module) {
//   const PORT = process.env.PORT || 3000;
//   app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
// }

// module.exports = app;

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
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(svcJson)) });
  }
  db = admin.firestore();
  console.log("Firebase Admin initialised");
} catch (err) {
  console.error("Firebase Admin init failed:", err.message);
}

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(helmet({ contentSecurityPolicy: false }));

// ── CORS ──────────────────────────────────────────────────────────────────────
const rawOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map((o) => o.trim()).filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
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
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "10kb" }));

// ── Rate limiters ─────────────────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, max: 60,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, error: "Too many requests. Try again later." },
}));
const couponLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, error: "Too many coupon attempts. Try again in 15 minutes." },
});

// ── Razorpay ──────────────────────────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const MIN_AMOUNT_INR = 1;
const MAX_AMOUNT_INR = 5000;

// ── Collection names (match your Firestore) ───────────────────────────────────
// Plans live as an array inside each company document in the mlmcomp collection:
//   mlmcomp/{companyId} → { Plans: [ { PlanName, PlanAmount, Day_value, … } ] }
const COL_COMPANY      = process.env.COMPANY_COLLECTION      || "mlmcomp";
const COL_COUPON       = process.env.COUPON_COLLECTION       || "couponcode";
const COL_SUBSCRIPTION = process.env.SUBSCRIPTION_COLLECTION || "subscription";
const COL_PAYMENTLOG   = process.env.PAYMENTLOG_COLLECTION   || "paymentlog";
const COL_PENDING      = "_pendingOrders"; // internal, never exposed to client

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

const requireDb = (req, res, next) => {
  if (!db) return res.status(503).json({ success: false, error: "Database unavailable" });
  next();
};

const formatDateForDB = (date) =>
  date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/",       (_req, res) => res.json({ status: "ok", message: "Payment service is running" }));

// ── POST / — Create Razorpay order (SECURE: server fetches plan price) ────────
//
// Plans are stored as an array inside each mlmcomp document — NOT as separate docs.
// Data shape: mlmcomp/{companyId} → { Plans: [ { PlanName, PlanAmount, … } ] }
//
// Client sends: { companyId, planName, couponCode?, userMobile?, userName? }
// Server:
//   1. Fetches the mlmcomp doc for companyId
//   2. Finds the plan whose PlanName matches planName (case-insensitive) — server owns the price
//   3. Validates coupon server-side
//   4. Calculates amount (discount + GST) server-side
//   5. Creates Razorpay order
//   6. Stores a _pendingOrders record for idempotent verification
//
app.post("/", requireApiKey, requireDb, async (req, res) => {
  // ── FIX 1: destructure planName (lowercase) to match what the frontend sends ──
  const { companyId, planName, couponCode, userMobile, userName } = req.body || {};

  // Validate required fields
  if (!companyId || typeof companyId !== "string" || companyId.trim().length === 0) {
    return res.status(400).json({ success: false, error: "companyId is required" });
  }

  // ── FIX 2: validate planName ──────────────────────────────────────────────
  if (!planName || typeof planName !== "string" || planName.trim().length === 0) {
    return res.status(400).json({ success: false, error: "planName is required" });
  }

  try {
    // 1. Fetch the company document from mlmcomp (server controls the price)
    const compSnap = await db.collection(COL_COMPANY).doc(companyId.trim()).get();
    if (!compSnap.exists) {
      return res.status(404).json({ success: false, error: "Company not found" });
    }

    const compData = compSnap.data();
    const plans    = Array.isArray(compData.Plans) ? compData.Plans : [];

    // ── FIX 3: use .find() (not .filter()) and match planName case-insensitively
    //           so "basic" == "Basic" and the client can't inject a fake name that
    //           slips past a strict equality check ────────────────────────────
    const normalise = (s) => String(s ?? "").trim().toLowerCase();
    const plan = plans.find(
      (p) => normalise(p.PlanName) === normalise(planName)
    );

    if (!plan) {
      return res.status(404).json({ success: false, error: `Plan "${planName}" not found` });
    }

    // ── FIX 4: check BOTH Launch and active flags with correct casing ─────────
    //   Firestore shape: { Launch: true/false, active: true/false }
    //   A plan is blocked only when a flag is explicitly set to false.
    if (plan.Launch === false || plan.active === false) {
      return res.status(400).json({ success: false, error: "This plan is not available for purchase" });
    }

    const baseAmt = Number(plan.PlanAmount ?? 0);
    if (!baseAmt || isNaN(baseAmt) || baseAmt <= 0) {
      return res.status(400).json({ success: false, error: "Plan has an invalid amount" });
    }

    // 2. Validate coupon server-side (server controls the discount — client cannot tamper)
    let discountPercent   = 0;
    let appliedCouponCode = null;
    if (couponCode && typeof couponCode === "string") {
      const code = couponCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (code.length === 6) {
        const cSnap = await db.collection(COL_COUPON).where("code", "==", code).limit(1).get();
        if (!cSnap.empty) {
          const cData = cSnap.docs[0].data();
          if (cData.active !== false) {
            const pct = Number(cData.user_discount ?? 0);
            if (!isNaN(pct) && pct >= 0 && pct <= 100) {
              discountPercent   = pct;
              appliedCouponCode = code;
            }
          }
        }
      }
    }

    // 3. Calculate final payable amount (server-side only — never trust the client)
    const discountAmt   = Math.floor((baseAmt * discountPercent) / 100);
    const afterDiscount = baseAmt - discountAmt;
    const gstAmt        = Math.round(afterDiscount * 0.18);
    const payableAmount = afterDiscount + gstAmt;

    if (payableAmount < MIN_AMOUNT_INR || payableAmount > MAX_AMOUNT_INR) {
      return res.status(400).json({
        success: false,
        error: `Payable amount ₹${payableAmount} is outside the allowed range`,
      });
    }

    // 4. Create Razorpay order (amount is what the server calculated — Razorpay enforces it)
    const receipt = uuidv4();
    const order   = await razorpay.orders.create({
      amount:   Math.round(payableAmount * 100), // Razorpay uses paise
      currency: "INR",
      receipt,
    });

    // 5. Store pending order — used by /verify-payment to write the subscription
    const today      = new Date();
    const expiryDate = new Date(today);
    expiryDate.setDate(expiryDate.getDate() + (Number(plan.Day_value) || 0));

    // ── FIX 5: removed stale `idx` variable (was from the old index-based approach)
    await db.collection(COL_PENDING).doc(order.id).set({
      orderId:         order.id,
      companyId,
      planName:        plan.PlanName || "",
      planType:        plan.Type     || "",
      baseAmount:      baseAmt,
      discountPercent,
      discountAmount:  discountAmt,
      couponCode:      appliedCouponCode,
      gstAmount:       gstAmt,
      payableAmount,
      duration:        Number(plan.Day_value)  || 0,
      downloads:       Number(plan.downloads)  || 0,
      userMobile:      userMobile || "",
      userName:        userName   || "",
      startDate:       today,
      expiryDate,
      receipt,
      processed:       false,
      createdAt:       admin.firestore.FieldValue.serverTimestamp(),
    });

    // 6. Return server-confirmed amounts — client MUST use these for the Razorpay widget
    return res.status(200).json({
      success:        true,
      order_id:       order.id,
      payableAmount,
      baseAmount:     baseAmt,
      discountAmount: discountAmt,
      discountPercent,
      gstAmount:      gstAmt,
      currency:       order.currency,
      planName:       plan.PlanName || "",
      expiryDays:     Number(plan.Day_value) || 0,
    });
  } catch (err) {
    console.error("Order creation failed:", err.message);
    return res.status(500).json({ success: false, error: "Order creation failed" });
  }
});

// ── POST /verify-payment — Verify signature + write subscription (SECURE) ─────
//
// BEFORE (vulnerable): browser wrote subscription record to Firestore directly —
//                      anyone with Firestore access could create free subscriptions.
// NOW (secure):        server verifies Razorpay signature, then writes the
//                      subscription using Firebase Admin SDK (bypasses client rules).
//                      Idempotent: replaying the same orderId returns success without
//                      creating a duplicate subscription.
//
app.post("/verify-payment", requireApiKey, requireDb, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature ||
      typeof razorpay_order_id   !== "string" ||
      typeof razorpay_payment_id !== "string" ||
      typeof razorpay_signature  !== "string") {
    return res.status(400).json({ success: false, error: "Missing or invalid payment fields" });
  }

  // 1. Verify Razorpay HMAC signature (timing-safe)
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

  try {
    // 2. Load the pending order (contains plan details stored at order creation)
    const pendingRef  = db.collection(COL_PENDING).doc(razorpay_order_id);
    const pendingSnap = await pendingRef.get();

    if (!pendingSnap.exists) {
      // Signature is valid but we have no pending order record.
      // Return success so the user isn't blocked; subscription won't be written.
      console.warn("verify-payment: no pending order for", razorpay_order_id);
      return res.status(200).json({ success: true, verified: true, dbWritten: false });
    }

    const pending = pendingSnap.data();

    // 3. Idempotency — already processed, return success without re-writing
    if (pending.processed) {
      return res.status(200).json({ success: true, verified: true, dbWritten: true, idempotent: true });
    }

    // 4. Write subscription record using Admin SDK (server controls this — client cannot fake it)
    const startDate  = pending.startDate?.toDate  ? pending.startDate.toDate()  : new Date();
    const expiryDate = pending.expiryDate?.toDate ? pending.expiryDate.toDate() : new Date();

    const subscriptionDoc = {
      OrderId:             razorpay_order_id,
      payment:             "Success",
      plan:                pending.planName,
      planType:            pending.planType,
      company:             pending.companyId,
      startdate:           formatDateForDB(startDate),
      expirydate:          formatDateForDB(expiryDate),
      download:            pending.downloads ?? 0,
      PurchaseAt:          admin.firestore.FieldValue.serverTimestamp(),
      PaymentAmount:       pending.payableAmount,
      duration:            pending.duration,
      mobileNo:            pending.userMobile,
      UserName:            pending.userName,
      Active:              true,
      Expire:              false,
      UTRID:               razorpay_order_id,
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      couponApplied:       pending.couponCode   || null,
      discountPercent:     pending.discountPercent ?? 0,
    };

    // Write both records in parallel
    await Promise.all([
      db.collection(COL_SUBSCRIPTION).add(subscriptionDoc),
      db.collection(COL_PAYMENTLOG).add(subscriptionDoc).catch(() => {}),
    ]);

    // 5. Mark pending order as processed (prevents duplicate subscriptions on retry)
    await pendingRef.update({
      processed:       true,
      processedAt:     admin.firestore.FieldValue.serverTimestamp(),
      razorpay_payment_id,
    });

    return res.status(200).json({ success: true, verified: true, dbWritten: true });
  } catch (err) {
    console.error("Verify payment error:", err.message);
    return res.status(500).json({ success: false, error: "Verification error" });
  }
});

// ── POST /validate-coupon — Coupon check (unchanged, already secure) ──────────
app.post("/validate-coupon", requireApiKey, couponLimiter, requireDb, async (req, res) => {
  const rawCode = req.body?.code;
  if (typeof rawCode !== "string") {
    return res.status(400).json({ success: false, error: "code must be a string" });
  }

  const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 6) {
    return res.status(400).json({
      success: false, error: "Coupon code must be exactly 6 alphanumeric characters",
    });
  }

  try {
    const snap = await db.collection(COL_COUPON).where("code", "==", code).limit(1).get();
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

// ── Start (local dev only — Vercel ignores this) ──────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
