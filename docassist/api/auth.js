export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { password } = req.body;

  if (password === process.env.APP_PASSWORD) {
    // Set a simple session cookie valid for 7 days
    res.setHeader('Set-Cookie', `da_session=authenticated; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${60 * 60 * 24 * 7}`);
    return res.status(200).json({ ok: true });
  }

  return res.status(401).json({ error: 'Incorrect password' });
}
