// Drop-in: wire the dashboard's "Allow" button to this.
const VAPID_PUBLIC_KEY = window.VAPID_PUBLIC_KEY; // injected by the page, see SETUP.md step 6

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export async function enablePush(who) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('This browser cannot do push. On iPhone, add the site to your Home Screen first.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, permission };

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
  });

  await fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ who, subscription })
  });

  return { ok: true };
}
