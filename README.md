# AI Disaster Watch — local dev proxy

This project is a static frontend demo. To safely use an API key without embedding it in client-side files, the repo includes a tiny Express server that reads the key from a local `.env` file and exposes a safe endpoint the frontend can call.

Important: Do NOT commit your real key to the repository. The server reads `process.env.MY_API_KEY` from a local `.env` file which should be ignored by git.

Quick start (Windows PowerShell):

```powershell
cd "c:\Users\Dinesh Jadhav\Desktop\motivation.html"
copy .env.example .env
# Edit .env and paste your key after the = sign (do NOT commit .env)
npm install
npm start
# Open http://localhost:3000 in your browser and click "Show API output"
```

What this does
- `server.js` serves your static files and exposes `/api/use-key`.
- For safety, the example endpoint returns a masked confirmation of the key. In a real integration, replace the endpoint implementation with code that calls your upstream API using the key and returns only the data your frontend needs.

Security notes
- Never embed secrets in client-side JS or commit them to source control.
- Prefer short-lived credentials, and if possible, call external APIs from server-side code with proper scopes and rate-limiting.

If you want I can: (a) wire an actual upstream API call (tell me which API), or (b) add minimal tests for the server.
