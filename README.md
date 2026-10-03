# CareQueue v2 – hospital appointments (MERN)

Google login, patient / doctor / admin areas, Razorpay (pay online or at counter), email confirmation only.
Stack: React (Vite) + Express + MongoDB Atlas + Upstash Redis, hosted on Vercel.

## Run locally
1. cp .env.example .env  (fill it in, see the steps in the chat reply or below)
2. npm install && npm --prefix client install
3. npm run dev  -> open http://localhost:5173

## Roles
- Patient: anyone who signs in with Google.
- Admin: Google emails listed in ADMIN_EMAILS.
- Doctor: Google email added by an admin under Admin > Doctors.

## Deploy on Vercel
Import the repo, Framework Preset = Other, add all variables from .env.example, deploy.
Then add your Vercel URL to Google OAuth "Authorized JavaScript origins" and add the Razorpay webhook:
  URL: https://YOUR-APP.vercel.app/api/payments/webhook   Event: payment.captured

## Notes
- Use a NEW MongoDB database name for v2 (the old unique index from v1 would conflict).
- Live queue uses 5 second polling (Vercel has no WebSockets).
- Double booking is blocked by a Redis lock plus a unique MongoDB index on the slot.
- If two people race for a slot and one has already paid, that payment is refunded automatically.
