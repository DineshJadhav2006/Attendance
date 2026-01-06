const express = require('express');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// parse JSON bodies for API endpoints
app.use(express.json());

// Simple assistant endpoint that forwards prompts to OpenAI
// Request body: { prompt: string }
app.post('/api/assistant', async (req, res) => {
  const prompt = (req.body && req.body.prompt) ? String(req.body.prompt) : '';
  if (!prompt) return res.status(400).json({ ok: false, error: 'Missing prompt' });

  // Ensure we have an API key
  const key = process.env.MY_API_KEY || '';
  if (!key) return res.status(500).json({ ok: false, error: 'Server missing API key' });

  try {
    console.log('assistant request prompt:', prompt.substring(0, 200));
    // Lazy import to avoid startup errors when dependency missing
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: key });

    // Small system prompt to keep answers helpful and safety-aware
    const system = `You are a helpful assistant for an AI Disaster Watch application. Provide concise, practical, and safety-minded answers. If user asks for location-specific advice, ask for city or climate. Don't reveal or echo API keys or internal server info.`;

    const resp = await client.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ],
      max_tokens: 400,
    });

    console.log('assistant raw resp keys:', Object.keys(resp || {}));

    const text = resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content
      ? resp.choices[0].message.content
      : (resp && resp.choices && resp.choices[0] && resp.choices[0].text) || '';

    return res.json({ ok: true, reply: String(text) });
  } catch (err) {
    console.error('assistant error', err && err.message ? err.message : err);
    try {
      return res.status(500).json({ ok: false, error: 'Assistant error', detail: err && err.message ? err.message : String(err) });
    } catch (e) {
      // If sending JSON failed (headers already sent), at least end the response
      try { res.end(); } catch (ee) {};
      return;
    }
  }
});

// Serve static files (your frontend)
app.use(express.static(path.join(__dirname)));

function maskKey(k) {
  if (!k) return '';
  if (k.length <= 8) return k.replace(/.(?=.{4})/g, '*');
  return k.slice(0, 4) + k.slice(4, -4).replace(/./g, '*') + k.slice(-4);
}

// Public endpoint the frontend calls. Keep the key on the server only.
app.get('/api/use-key', (req, res) => {
  let key = process.env.MY_API_KEY;
  // Fallback: if dotenv didn't load for some reason, try to read .env directly from the project folder
  if (!key) {
    try {
      const fs = require('fs');
      const envText = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
      const m = envText.match(/^MY_API_KEY=(.*)$/m);
      if (m) key = (m[1] || '').trim();
    } catch (e) {
      // ignore file read errors; we'll return the missing-key error below
    }
  }
  if (!key) {
    return res.status(400).json({ ok: false, error: 'No API key configured. Create a local .env with MY_API_KEY.' });
  }

  // NOTE: This endpoint should call the real upstream API using the key.
  // For safety and because the target API wasn't specified, we only return a safe masked confirmation here.
  return res.json({ ok: true, message: 'API key loaded on server.', maskedKey: maskKey(key) });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  // Diagnostic: confirm whether dotenv loaded the key (do NOT print the key itself)
  console.log('MY_API_KEY present on server:', !!process.env.MY_API_KEY);
});
