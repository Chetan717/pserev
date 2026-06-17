# Razorpay Order Service — Express + Vercel

A minimal Express REST API that creates Razorpay orders, protected by an API key,
and ready to deploy on Vercel in one command.

---

## Project Structure

```
razorpay-order-service/
├── api/
│   └── index.js       ← Express app (Vercel serverless entry)
├── .env.example       ← Copy to .env for local dev
├── .gitignore
├── package.json
├── vercel.json        ← Vercel routing config
└── README.md
```

---

## API Reference

### `GET /`
Health check.

**Response**
```json
{ "status": "ok", "message": "Razorpay Order Service is running" }
```

---

### `POST /api/create-order?API_KEY=<your_key>`

Creates a Razorpay order.

**Query Parameter**

| Param     | Required | Description                          |
|-----------|----------|--------------------------------------|
| `API_KEY` | ✅       | Must match a key in `VALID_API_KEYS` |

**Request Body**

```json
{ "amount": 500 }
```
> `amount` is in **INR** — the API converts it to paise automatically.

**Success Response (200)**

```json
{
  "success": true,
  "order_id": "order_OXAbCdEfGh1234",
  "amount": 50000,
  "currency": "INR",
  "receipt": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Error Responses**

| Status | Reason                      |
|--------|-----------------------------|
| 400    | Missing or invalid `amount` |
| 403    | Invalid or missing API key  |
| 500    | Razorpay API error          |

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
cp .env.example .env
# Fill in your values in .env

# 3. Start dev server
npm run dev
# → Running on http://localhost:3000

# 4. Test the endpoint
curl -X POST "http://localhost:3000/api/create-order?API_KEY=your_secret_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{"amount": 500}'
```

---

## Deploy to Vercel

### Option A — Vercel CLI (recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy (follow the prompts)
vercel

# Set environment variables on Vercel
vercel env add RAZORPAY_KEY_ID
vercel env add RAZORPAY_KEY_SECRET
vercel env add VALID_API_KEYS

# Deploy to production
vercel --prod
```

### Option B — Vercel Dashboard (Git)

1. Push this repo to GitHub / GitLab / Bitbucket.
2. Go to [vercel.com/new](https://vercel.com/new) → Import the repo.
3. Add the three environment variables in **Settings → Environment Variables**:
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
   - `VALID_API_KEYS`
4. Click **Deploy**.

Your API will be live at `https://<your-project>.vercel.app`.

---

## Environment Variables

| Variable            | Description                                                |
|---------------------|------------------------------------------------------------|
| `RAZORPAY_KEY_ID`   | Razorpay Key ID from the dashboard                        |
| `RAZORPAY_KEY_SECRET` | Razorpay Key Secret from the dashboard                  |
| `VALID_API_KEYS`    | Comma-separated list of allowed API keys, e.g. `k1,k2`   |

> Use **test keys** (`rzp_test_...`) during development and **live keys** (`rzp_live_...`) in production.
