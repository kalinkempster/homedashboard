import { sql } from './_db.js';

// Body: { who, subscription }  — stores this device's push endpoint.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { who, subscription } = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ error: 'subscription required' });

  await sql`
    insert into subscriptions (who, endpoint, p256dh, auth)
    values (${who || 'unknown'}, ${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth})
    on conflict (endpoint) do update set who = ${who || 'unknown'}`;

  res.json({ ok: true });
}
