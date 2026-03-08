export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check session cookie
  const cookies = req.headers.cookie || '';
  const authenticated = cookies.split(';').some(c => c.trim() === 'da_session=authenticated');
  if (!authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { system, user, maxTokens } = req.body;

    if (!system || !user) {
      return res.status(400).json({ error: 'Missing system or user prompt' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens || 2000,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }

    const text = data.content.map(b => b.text || '').join('').trim();
    return res.status(200).json({ text });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
