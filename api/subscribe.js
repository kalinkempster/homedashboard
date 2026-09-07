import { sql } from './_db.js';

// Body: { who, subscription }  — stores this device's push endpoint.
export default async function handler(req, res) {
  // A device dropping its own subscription (used by "Re-register this phone").
  if (req.method === 'DELETE') {
    const { endpoint } = req.body || {};
    if (endpoint) await sql`delete from subscriptions where endpoint = ${endpoint}`;
    return res.json({ ok: true });
  }
  if (req.method !== 'POST') return res.status(405).end();
  const { who, subscription } = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ error: 'subscription required' });

  await sql`
    insert into subscriptions (who, endpoint, p256dh, auth)
    values (${who || 'unknown'}, ${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth})
    on conflict (endpoint) do update set who = ${who || 'unknown'}`;

  res.json({ ok: true });
}
