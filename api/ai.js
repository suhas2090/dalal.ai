export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { provider = 'gemini', prompt, geminiKey, groqKey } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    if (provider === 'groq') {
      const key = process.env.GROQ_API_KEY || groqKey;
      if (!key) return res.status(400).json({ error: 'Missing Groq key' });
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);
      return res.status(200).json({ text: data?.choices?.[0]?.message?.content || '' });
    }

    const key = process.env.GEMINI_API_KEY || geminiKey;
    if (!key) return res.status(400).json({ error: 'Missing Gemini key' });
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4000 },
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    return res.status(200).json({ text: data?.candidates?.[0]?.content?.parts?.[0]?.text || '' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Server error' });
  }
}
