export default function handler(req, res) {
  res.json({ vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null });
}
