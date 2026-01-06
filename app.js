/* AI Disaster Watch — Frontend demo
   Unique features:
   - Confidence gauge + impact radius visualization
   - Heat overlays on a simple canvas "map"
   - Geofenced alert subscriptions with quiet-hours logic
   - Multilingual (English/Marathi) strings
   - Offline caching via simple static assets "preload"
*/

// ---- i18n ----
const i18n = {
  en: {
    controls_title: "Controls",
    location_label: "Location:",
    location_help: "Enter city/town or coordinates.",
    use_gps: "Use GPS",
    predict_btn: "Run AI prediction",
    subscribe_btn: "Subscribe to area alerts",
    map_title: "Risk map",
    intel_title: "AI intelligence",
    alerts_title: "Alerts",
  },
  mr: {
    controls_title: "नियंत्रणे",
    location_label: "ठिकाण:",
    location_help: "शहर/गाव किंवा अक्षांश-रेखांश द्या.",
    use_gps: "GPS वापरा",
    predict_btn: "AI भविष्यवाणी चालवा",
    subscribe_btn: "क्षेत्र अलर्ट सदस्यता",
    map_title: "जोखीम नकाशा",
    intel_title: "AI माहिती",
    alerts_title: "सूचना",
  }
};

let currentLang = "en";
function setLang(lang) {
  currentLang = lang;
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    el.textContent = i18n[lang][key] || el.textContent;
  });
  document.getElementById("lang-en").setAttribute("aria-pressed", lang === "en");
  document.getElementById("lang-mr").setAttribute("aria-pressed", lang === "mr");
}

document.getElementById("lang-en").addEventListener("click", () => setLang("en"));
document.getElementById("lang-mr").addEventListener("click", () => setLang("mr"));
setLang("en");

// ---- elements ----
const timeRange = document.getElementById("timeHorizon");
const timeValue = document.getElementById("timeHorizonValue");
const predictBtn = document.getElementById("predict");
const subscribeBtn = document.getElementById("subscribe");
const alertsFeed = document.getElementById("alertsFeed");
const simulateAlertBtn = document.getElementById("simulateAlert");
const clearAlertsBtn = document.getElementById("clearAlerts");
const mapCanvas = document.getElementById("mapCanvas");
const ctx = mapCanvas.getContext("2d");
const gauge = document.getElementById("confidenceGauge");
const confidenceText = document.getElementById("confidenceText");
const impactRadiusEl = document.getElementById("impactRadius");
const affectedPopEl = document.getElementById("affectedPop");
const recommendationsEl = document.getElementById("recommendations");
const lastUpdatedEl = document.getElementById("lastUpdated");
const locationPreset = document.getElementById('locationPreset');
const gpsConfirmContainer = document.getElementById('gpsConfirmContainer');
const confirmGpsBtn = document.getElementById('confirmGps');
let pendingGpsLocation = null;

timeRange.addEventListener("input", () => {
  timeValue.textContent = `${timeRange.value}h`;
});

// ---- mock geolocation ----
document.getElementById("use-gps").addEventListener("click", async () => {
  if (!navigator.geolocation) {
    toast("Geolocation not available.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      // Don't immediately overwrite user's Location field — let them confirm
      pendingGpsLocation = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
      // show a small confirm button so user can accept the detected coords
      if (gpsConfirmContainer) gpsConfirmContainer.style.display = 'inline-block';
      toast('Location detected. Click "Confirm current location" to apply.');
    },
    () => toast("Failed to get location.")
  );
});

// when user confirms the GPS-detected location, apply it
if (confirmGpsBtn) {
  confirmGpsBtn.addEventListener('click', () => {
    if (!pendingGpsLocation) {
      toast('No GPS location pending. Click Use GPS first.');
      return;
    }
    document.getElementById('location').value = pendingGpsLocation;
    pendingGpsLocation = null;
    if (gpsConfirmContainer) gpsConfirmContainer.style.display = 'none';
    drawMap({ x: mapCanvas.width / 2, y: mapCanvas.height / 2 });
    toast('Location set from GPS.');
  });
}

// allow choosing a preset city which fills the location field
if (locationPreset) {
  locationPreset.addEventListener('change', (e) => {
    const v = e.target.value || '';
    if (v) {
      document.getElementById('location').value = v;
      toast(`Location set: ${v}`);
      // Render demo weather for known presets so user sees temp/humidity/pressure etc.
      try {
        const w = getDemoWeatherForCity(v);
        if (w) renderWeatherTilesFromApi(w);
      } catch (err) {
        console.error('Failed to render demo weather for city', err);
      }
    } else {
      // hide weather grid when user clears selection
      const grid = document.getElementById('weatherGrid');
      if (grid) grid.style.display = 'none';
    }
  });
}

// ---- AI mock prediction ----
predictBtn.addEventListener("click", () => {
  const place = document.getElementById("location").value.trim() || "Rahta, MH, India";
  const type = document.getElementById("disasterType").value;
  const hours = parseInt(timeRange.value, 10);
  const riskFactors = [
    document.getElementById("nearRiver").checked ? 0.15 : 0,
    document.getElementById("oldBuilding").checked ? 0.1 : 0,
    document.getElementById("flatRoof").checked ? 0.05 : 0,
  ].reduce((a, b) => a + b, 0);

  const baseRisk = seedFrom(`${place}-${type}`) % 0.6; // pseudo base risk
  const horizonBoost = Math.min(hours / 72, 1) * 0.25;
  const confidence = clamp((baseRisk + horizonBoost + riskFactors), 0.05, 0.98);

  // Impact radius roughly proportional to confidence and type
  const typeFactor = { flood: 1.0, cyclone: 1.2, earthquake: 1.5, heatwave: 1.1, landslide: 0.8 }[type];
  const radiusKm = Math.round(confidence * 100 * typeFactor) + 5;
  const affectedPop = Math.round(radiusKm * (50 + confidence * 150)); // simple heuristic

  updateGauge(confidence);
  confidenceText.textContent = `Confidence: ${(confidence * 100).toFixed(1)}% for ${type} in ${place} (next ${hours}h)`;
  impactRadiusEl.textContent = `Estimated impact radius: ${radiusKm} km`;
  affectedPopEl.textContent = `Potentially affected population: ~${affectedPop.toLocaleString()}`;

  const recs = getRecommendations(type, confidence, { hours });
  renderRecommendations(recs);

  drawMap({ x: mapCanvas.width / 2, y: mapCanvas.height / 2 }, { radiusKm, confidence, type });
  stampUpdated();
});

// ---- subscribe alerts (geofence + quiet hours) ----
let subscriptions = [];
subscribeBtn.addEventListener("click", () => {
  const place = document.getElementById("location").value.trim() || "Rahta, MH, India";
  const type = document.getElementById("disasterType").value;
  subscriptions.push({ place, type, createdAt: Date.now() });
  toast(`Subscribed to alerts for ${type} near ${place}`);
});

// ---- simulate external alert ----
simulateAlertBtn.addEventListener("click", () => {
  const type = randomPick(["flood", "cyclone", "earthquake", "heatwave", "landslide"]);
  const severity = randomPick(["low", "medium", "high"]);
  const title = `Alert: ${capitalize(type)} (${severity})`;
  const desc = {
    low: "Monitor conditions. No immediate action.",
    medium: "Prepare to move to safer ground.",
    high: "Evacuate if instructed. Avoid travel."
  }[severity];
  const ts = new Date().toLocaleString();

  if (isQuietHours() && document.getElementById("quietHours").checked) {
    // Store silently
    addAlertCard({ title: title + " (queued)", desc, severity, ts });
  } else {
    addAlertCard({ title, desc, severity, ts });
    if (document.getElementById("pushAlerts").checked) notify(title, desc);
    if (document.getElementById("smsAlerts").checked) {
      // Demo: pretend to POST to webhook
      console.log("[SMS webhook] Would send:", { title, desc, severity, ts });
    }
  }
});

// ---- clear alerts ----
clearAlertsBtn.addEventListener("click", () => {
  alertsFeed.innerHTML = "";
});

// ---- map drawing ----
function drawMap(center = { x: 350, y: 210 }, meta = null) {
  // Base
  ctx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
  const grad = ctx.createLinearGradient(0, 0, 0, mapCanvas.height);
  grad.addColorStop(0, "#0b1224");
  grad.addColorStop(1, "#0d1326");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);

  // Grid
  ctx.strokeStyle = "#1e2a45";
  ctx.lineWidth = 1;
  for (let x = 50; x < mapCanvas.width; x += 50) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, mapCanvas.height); ctx.stroke();
  }
  for (let y = 50; y < mapCanvas.height; y += 50) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(mapCanvas.width, y); ctx.stroke();
  }

  // Center marker
  ctx.fillStyle = "#4f7cff";
  ctx.beginPath(); ctx.arc(center.x, center.y, 6, 0, Math.PI * 2); ctx.fill();

  if (meta) {
    const pxPerKm = 2;
    const radiusPx = meta.radiusKm * pxPerKm;
    // Heat halo
    const heat = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radiusPx);
    heat.addColorStop(0, "rgba(255,95,109,0.35)");
    heat.addColorStop(0.6, "rgba(255,182,79,0.2)");
    heat.addColorStop(1, "rgba(63,211,154,0.05)");
    ctx.fillStyle = heat;
    ctx.beginPath(); ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2); ctx.fill();

    // Contours
    ctx.strokeStyle = "#ff5f6d";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    // Label
    ctx.fillStyle = "#e5eaf5";
    ctx.font = "12px Segoe UI";
    ctx.fillText(`${capitalize(meta.type)} radius ~${meta.radiusKm}km`, center.x + 10, center.y - 10);
  }
}

// ---- map helpers ----
document.getElementById("recenter").addEventListener("click", () => drawMap());
let heatOn = true;
document.getElementById("toggleHeat").addEventListener("click", () => {
  heatOn = !heatOn;
  // Redraw with/without halo by passing meta only when heatOn true
  drawMap({ x: mapCanvas.width / 2, y: mapCanvas.height / 2 }, heatOn ? lastMeta : null);
});
document.getElementById("downloadPNG").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = mapCanvas.toDataURL("image/png");
  a.download = "risk-map.png";
  a.click();
});

let lastMeta = null;
function stampUpdated() {
  lastUpdatedEl.textContent = new Date().toLocaleString();
}

// ---- gauge ----
function updateGauge(conf) {
  gauge.style.setProperty("--conf", conf);
  gauge.style.setProperty("--percent", `${(conf * 100).toFixed(1)}%`);
  gauge.style.setProperty("--color", conf > 0.7 ? "#ff5f6d" : conf > 0.4 ? "#ffb64f" : "#3fd39a");
  // Avoid querying pseudo-elements with querySelector (invalid selector in DOM)
  // gauge.querySelector("::after"); // removed because it throws in some browsers
  gauge.style.position = "relative";
  gauge.style.setProperty("--w", `${conf * 100}%`);
  // Since we can't style ::after via JS directly, adjust width using inline style hack:
  gauge.innerHTML = `<div style="width:${conf * 100}%; height:100%; background:linear-gradient(90deg,#3fd39a,#ffb64f,#ff5f6d)"></div>`;
  lastMeta = lastMeta || {};
}

// ---- recommendations ----
function getRecommendations(type, conf, { hours }) {
  const list = [];
  if (type === "flood") {
    list.push("Move valuables above ground level.");
    list.push("Avoid crossing fast-moving water.");
    if (conf > 0.6) list.push("Prepare to relocate to higher ground.");
  } else if (type === "earthquake") {
    list.push("Secure heavy furniture to walls.");
    list.push("Identify safe drop-cover-hold spots.");
    if (conf > 0.6) list.push("Keep go-bags ready (water, meds, IDs).");
  } else if (type === "cyclone") {
    list.push("Reinforce windows and doors.");
    list.push("Stock essentials for 48–72h.");
    if (conf > 0.6) list.push("Plan evacuation route inland.");
  } else if (type === "heatwave") {
    list.push("Hydrate and avoid peak sun.");
    list.push("Check vulnerable neighbors.");
    if (conf > 0.6) list.push("Create a cool room with ventilation.");
  } else if (type === "landslide") {
    list.push("Avoid steep slopes and loose soil.");
    list.push("Watch for cracks and leaning trees.");
    if (conf > 0.6) list.push("Plan alternate travel routes.");
  }
  if (hours > 48) list.push("Verify supplies for extended period.");
  return list;
}
function renderRecommendations(recs) {
  recommendationsEl.innerHTML = "";
  for (const r of recs) {
    const li = document.createElement("li");
    li.textContent = r;
    recommendationsEl.appendChild(li);
  }
}

// ---- gardening suggestions helper ----
function generatePlantSuggestionForSeason(season, place) {
  season = (season || 'summer').toLowerCase();
  const placeText = place ? `for ${place}` : 'for your area';
  const lines = [];
  if (season === 'summer') {
    lines.push(`Summer-friendly plants ${placeText}:`);
    lines.push(`- Vegetables: tomatoes, okra (bhindi), eggplant (brinjal), chillies, cucumbers, bottle gourd, pumpkins, snake gourd.`);
    lines.push(`- Herbs: basil (tulsi), lemongrass, curry leaf.`);
    lines.push(`- Greens: amaranth (chaulai), cowpea, sweet potato greens.`);
    lines.push(`- Flowers: marigold, sunflower, zinnia, cosmos.`);
    lines.push(`Care tips: Water early morning or late evening, mulch to retain moisture, provide partial shade for seedlings, use well-draining soil.`);
  } else if (season === 'monsoon' || season === 'rainy') {
    lines.push(`Monsoon-friendly plants ${placeText}:`);
    lines.push(`- Vegetables: colocasia (arbi), ridge gourd, bottle gourd, okra (in well-drained beds), leafy greens tolerant to wet soils like spinach alternatives.`);
    lines.push(`- Herbs: coriander (during cooler monsoon spells), lemon grass.`);
    lines.push(`- Flowers: water-tolerant marigolds, tuberose, gladiolus (in raised beds).`);
    lines.push(`Care tips: Ensure raised beds or good drainage, avoid waterlogging, sow when heavy rains subside, space plants to reduce fungal disease.`);
  } else if (season === 'winter' || season === 'cold') {
    lines.push(`Winter-friendly plants ${placeText}:`);
    lines.push(`- Vegetables: cabbage, cauliflower, carrot, radish, peas, spinach.`);
    lines.push(`- Herbs: coriander, dill, fenugreek (methi).`);
    lines.push(`- Flowers: calendula, pansy, snapdragon.`);
    lines.push(`Care tips: Use mulches to keep soil warm, water in morning to let foliage dry, protect young seedlings from cold snaps.`);
  } else {
    lines.push(`Plant suggestions ${placeText}:`);
    lines.push(`- Try tomatoes, basil, marigold as easy starters; tell me a season (summer/monsoon/winter) for more tailored suggestions.`);
  }
  // Add spacing / sowing / container guidance for common plants
  const guidance = {
    tomatoes: { spacing: '45–60 cm between plants', container: '20–30 L pot', sow: 'start indoors and transplant after 4–6 weeks' },
    okra: { spacing: '30–45 cm', container: '15–20 L pot', sow: 'direct sow after last frost/when warm' },
    eggplant: { spacing: '45–60 cm', container: '20–25 L', sow: 'start indoors and transplant' },
    chillies: { spacing: '30–45 cm', container: '8–15 L', sow: 'start indoors; transplant when 6–8 weeks' },
    cucumber: { spacing: '60–90 cm (trellis)', container: '20–30 L with trellis', sow: 'direct sow or transplant' },
    bottle_gourd: { spacing: '1–1.5 m with vines', container: 'large bed or 30L+ with support', sow: 'direct sow after warming' },
    basil: { spacing: '20–25 cm', container: '3–5 L pot', sow: 'seed or cuttings; trim regularly' },
    marigold: { spacing: '20–30 cm', container: '3–5 L pot', sow: 'direct sow or transplant' },
    spinach: { spacing: '10–15 cm', container: '5–10 L', sow: 'direct sow in cool weather' },
    peas: { spacing: '5–10 cm (rows 30 cm apart)', container: '10–15 L with support', sow: 'direct sow in cool weather' }
  };

  lines.push('Planting & container tips:');
  lines.push('- If you have pots, choose a container at least the recommended size and use good-quality potting mix.');
  lines.push('- For beds, follow the spacing guidance below to avoid overcrowding and disease.');
  lines.push('- Seed vs transplant: many warm-season crops (tomato, eggplant, chillies) are easier when started indoors and transplanted; vining crops (cucumber, bottle gourd) can be direct-sown or transplanted to a trellis.');
  lines.push('- Mulch and regular watering help especially in summer; ensure good drainage during monsoon to avoid waterlogging.');

  // show a concise table-like list for a few common plants depending on season
  const showPlants = [];
  if (season === 'summer') showPlants.push('tomatoes', 'okra', 'eggplant', 'chillies', 'cucumber', 'basil', 'marigold');
  else if (season === 'monsoon') showPlants.push('bottle_gourd', 'okra', 'marigold', 'spinach');
  else if (season === 'winter') showPlants.push('spinach', 'peas', 'carrot', 'radish', 'cabbage');
  else showPlants.push('tomatoes', 'basil', 'marigold');

  for (const key of showPlants) {
    const p = guidance[key] || null;
    if (p) {
      lines.push(`- ${key.replace(/_/g, ' ')}: spacing ${p.spacing}; container ${p.container}; sow/transplant: ${p.sow}.`);
    } else {
      // generic fallback line
      lines.push(`- ${key.replace(/_/g, ' ')}: follow general spacing and container guidance above.`);
    }
  }

  lines.push(`If you have a balcony, pots, or a garden bed, say so and I will tailor container sizes and a planting schedule.`);
  return lines.join('\n');
}

// ---- alerts UI ----
function addAlertCard({ title, desc, severity, ts }) {
  const card = document.createElement("div");
  card.className = `alert-card ${severity}`;
  card.innerHTML = `
    <div class="alert-title">${title}</div>
    <div class="alert-meta">${ts}</div>
    <div class="alert-desc">${desc}</div>
  `;
  alertsFeed.prepend(card);
}

// ---- push notify ----
function notify(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, { body });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then(p => {
      if (p === "granted") new Notification(title, { body });
    });
  }
}

// ---- quiet hours ----
function isQuietHours() {
  const now = new Date();
  const hour = now.getHours();
  return hour >= 22 || hour < 6;
}

// ---- utils ----
function randomPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function seedFrom(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h) / 1e9;
}
function toast(msg) {
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.position = "fixed";
  t.style.bottom = "16px";
  t.style.left = "16px";
  t.style.background = "#122041";
  t.style.border = "1px solid #253050";
  t.style.color = "#e5eaf5";
  t.style.padding = "8px 12px";
  t.style.borderRadius = "10px";
  t.style.boxShadow = "0 12px 24px rgba(0,0,0,.25)";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ---- initial render ----
drawMap();
stampUpdated();

// ---- offline caching (Service Worker) ----
// Register a Service Worker to enable offline mode and cache assets
if ('serviceWorker' in navigator) {
  // Create an inline Service Worker to cache assets
  const swCode = `
    const CACHE_NAME = 'ai-disaster-watch-v1';
    const urlsToCache = [
      '/',
      '/index.html',
      '/styles.css',
      '/app.js',
      '/assets/gps-icon.png'
    ];

    self.addEventListener('install', (event) => {
      event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
          return cache.addAll(urlsToCache).catch(() => {
            console.log('[SW] Some assets failed to cache; continuing offline with available resources.');
          });
        })
      );
      self.skipWaiting();
    });

    self.addEventListener('activate', (event) => {
      event.waitUntil(
        caches.keys().then((cacheNames) => {
          return Promise.all(
            cacheNames.map((cacheName) => {
              if (cacheName !== CACHE_NAME) {
                return caches.delete(cacheName);
              }
            })
          );
        })
      );
      self.clients.claim();
    });

    self.addEventListener('fetch', (event) => {
      if (event.request.method !== 'GET') return;
      
      event.respondWith(
        caches.match(event.request).then((response) => {
          if (response) return response;
          
          return fetch(event.request).then((response) => {
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
            return response;
          }).catch(() => {
            // Return a fallback for failed requests
            if (event.request.destination === 'image') {
              return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="#ddd" width="100" height="100"/></svg>', {
                headers: { 'Content-Type': 'image/svg+xml' }
              });
            }
            return new Response('Offline - resource not cached', { status: 503 });
          });
        })
      );
    });
  `;
  
  const blob = new Blob([swCode], { type: 'application/javascript' });
  const swUrl = URL.createObjectURL(blob);
  
  navigator.serviceWorker.register(swUrl, { scope: '/' })
    .then(() => console.log('[App] Service Worker registered for offline caching'))
    .catch((err) => console.log('[App] Service Worker registration failed:', err));
} else {
  console.log('[App] Service Workers not supported; offline mode unavailable');
}

// ---- demo: call server-side proxy that uses the API key from a local .env ----
const showOutputBtn = document.getElementById("showOutput");
const apiOutput = document.getElementById("apiOutput");
if (showOutputBtn && apiOutput) {
  showOutputBtn.addEventListener("click", async () => {
    apiOutput.textContent = "Loading...";
      try {
        const resp = await fetch('/api/use-key');
        const ct = resp.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const json = await resp.json();
          apiOutput.textContent = JSON.stringify(json, null, 2);
          // If the JSON looks like weather, render tiles
          if (json && (json.temp || json.temperature || json.humidity)) {
            renderWeatherTilesFromApi(json);
          }
        } else {
          // Fallback: server returned HTML or plain text (e.g., a 404 page).
          // Instead of showing raw HTML, render demo weather for the currently selected city.
          const txt = await resp.text();
          apiOutput.textContent = `API unavailable (status ${resp.status}). Showing demo weather.`;
          const statusEl = document.getElementById('apiStatus');
          if (statusEl) statusEl.textContent = `API unavailable (status ${resp.status}) — showing demo weather.`;

          // Determine selected city from the location input or preset
          const locInput = document.getElementById('location');
          const preset = document.getElementById('locationPreset');
          const locVal = (locInput && locInput.value) ? locInput.value.trim() : ((preset && preset.value) ? preset.value.trim() : '');

          try {
            const demo = getDemoWeatherForCity(locVal || (preset && preset.value));
            renderWeatherTilesFromApi(demo);
          } catch (err) {
            console.error('Failed to render demo weather after API fallback', err);
            // Final fallback: show the server text and reveal demo button
            apiOutput.textContent = `Non-JSON response (status ${resp.status}):\n` + txt;
            if (statusEl) statusEl.textContent = `Non-JSON response (status ${resp.status})`;
            const grid = document.getElementById('weatherGrid'); if (grid) grid.style.display = 'none';
            const demoBtn = document.getElementById('showDemoWeather'); if (demoBtn) demoBtn.style.display = 'inline-block';
          }
        }
      } catch (err) {
        apiOutput.textContent = `Request failed: ${err && err.message ? err.message : err}`;
      }
  });
}

// Demo weather data and rendering
const demoWeather = {
  temp: 21.8,
  feels_like: 21.5,
  humidity: 54,
  rainfall_1h: 0.0,
  wind_kmh: 10.7,
  pressure_hpa: 1018,
  visibility_km: 10.0,
  aqi: 5,
  uv_index: null,
  sunrise: '06:40 am',
  sunset: '05:40 pm'
};

// Return demo weather tailored to a few preset cities with realistic seasonal values.
function getDemoWeatherForCity(city) {
  if (!city) return demoWeather;
  const c = city.toLowerCase();
  
  // City-specific weather profiles: temp, feels_like, humidity, wind_kmh, pressure_hpa, rainfall_1h, aqi, sunrise, sunset
  if (c.includes('pune')) 
    return { temp: 26.4, feels_like: 27.0, humidity: 48, rainfall_1h: 0.0, wind_kmh: 9, pressure_hpa: 1012, visibility_km: 10.0, aqi: 65, uv_index: 7, sunrise: '06:45 am', sunset: '05:35 pm' };
  
  if (c.includes('mumbai')) 
    return { temp: 29.2, feels_like: 31.6, humidity: 72, rainfall_1h: 0.8, wind_kmh: 14, pressure_hpa: 1008, visibility_km: 8.5, aqi: 85, uv_index: 8, sunrise: '06:52 am', sunset: '05:40 pm' };
  
  if (c.includes('nagpur')) 
    return { temp: 33.1, feels_like: 35.0, humidity: 38, rainfall_1h: 0.0, wind_kmh: 7, pressure_hpa: 1009, visibility_km: 11.0, aqi: 72, uv_index: 9, sunrise: '06:30 am', sunset: '05:25 pm' };
  
  if (c.includes('delhi')) 
    return { temp: 19.0, feels_like: 18.6, humidity: 54, rainfall_1h: 0.0, wind_kmh: 12, pressure_hpa: 1015, visibility_km: 7.0, aqi: 120, uv_index: 6, sunrise: '06:50 am', sunset: '05:15 pm' };
  
  if (c.includes('bengaluru')) 
    return { temp: 22.5, feels_like: 22.0, humidity: 62, rainfall_1h: 0.2, wind_kmh: 8, pressure_hpa: 1016, visibility_km: 10.0, aqi: 58, uv_index: 6, sunrise: '06:20 am', sunset: '05:50 pm' };
  
  if (c.includes('hyderabad')) 
    return { temp: 30.0, feels_like: 31.2, humidity: 40, rainfall_1h: 0.0, wind_kmh: 10, pressure_hpa: 1010, visibility_km: 10.5, aqi: 75, uv_index: 8, sunrise: '06:25 am', sunset: '05:30 pm' };
  
  if (c.includes('chennai')) 
    return { temp: 31.5, feels_like: 33.0, humidity: 70, rainfall_1h: 0.3, wind_kmh: 18, pressure_hpa: 1007, visibility_km: 9.0, aqi: 88, uv_index: 9, sunrise: '06:10 am', sunset: '05:55 pm' };
  
  if (c.includes('kolkata')) 
    return { temp: 28.8, feels_like: 30.0, humidity: 78, rainfall_1h: 1.4, wind_kmh: 11, pressure_hpa: 1006, visibility_km: 8.0, aqi: 95, uv_index: 7, sunrise: '06:05 am', sunset: '05:05 pm' };
  
  if (c.includes('jaipur')) 
    return { temp: 24.0, feels_like: 24.3, humidity: 32, rainfall_1h: 0.0, wind_kmh: 6, pressure_hpa: 1019, visibility_km: 11.5, aqi: 68, uv_index: 8, sunrise: '07:00 am', sunset: '05:10 pm' };
  
  // Fallback: small variation from base demo
  return { 
    temp: (demoWeather.temp + (Math.random() * 6 - 3)).toFixed(1) - 0, 
    feels_like: (demoWeather.feels_like + (Math.random() * 4 - 2)).toFixed(1) - 0,
    humidity: Math.max(10, Math.min(100, demoWeather.humidity + Math.round(Math.random() * 40 - 20))),
    rainfall_1h: demoWeather.rainfall_1h,
    wind_kmh: (demoWeather.wind_kmh + (Math.random() * 6 - 3)).toFixed(1) - 0,
    pressure_hpa: demoWeather.pressure_hpa + Math.round(Math.random() * 10 - 5),
    visibility_km: demoWeather.visibility_km,
    aqi: Math.round(demoWeather.aqi + (Math.random() * 50 - 25)),
    uv_index: demoWeather.uv_index,
    sunrise: demoWeather.sunrise,
    sunset: demoWeather.sunset
  };
}

function renderWeatherTilesFromApi(data) {
  const grid = document.getElementById('weatherGrid');
  const status = document.getElementById('apiStatus');
  if (!grid) return;
  grid.innerHTML = '';
  document.getElementById('showDemoWeather').style.display = 'none';
  status.textContent = '';
  // big temp tile
  const big = document.createElement('div'); big.className = 'weather-tile large';
  big.innerHTML = `<div style="font-size:14px; opacity:0.95">Current</div><div class="metric">${(data.temp||data.temperature||'—')}°C</div><div class="label">Feels like ${(data.feels_like||'—')}°C</div>`;
  grid.appendChild(big);

  const tiles = [
    { k: 'humidity', label: 'Humidity', val: () => (data.humidity != null ? data.humidity + '%' : '—') },
    { k: 'rain', label: 'Rainfall (1h)', val: () => (data.rainfall_1h != null ? data.rainfall_1h + ' mm' : '—') },
    { k: 'wind', label: 'Wind Speed', val: () => (data.wind_kmh != null ? data.wind_kmh + ' km/h' : '—') },
    { k: 'pressure', label: 'Pressure', val: () => (data.pressure_hpa != null ? data.pressure_hpa + ' hPa' : '—') },
    { k: 'visibility', label: 'Visibility', val: () => (data.visibility_km != null ? data.visibility_km + ' km' : '—') },
    { k: 'aqi', label: 'Air Quality (AQI)', val: () => (data.aqi != null ? data.aqi : '—') },
    { k: 'uv', label: 'UV Index', val: () => (data.uv_index != null ? data.uv_index : 'N/A') },
    { k: 'sunrise', label: 'Sunrise', val: () => (data.sunrise || '—') },
    { k: 'sunset', label: 'Sunset', val: () => (data.sunset || '—') }
  ];

  for (const t of tiles) {
    const d = document.createElement('div'); d.className = 'weather-tile';
    d.innerHTML = `<div class="label">${t.label}</div><div class="metric">${t.val()}</div>`;
    grid.appendChild(d);
  }
  grid.style.display = 'grid';
}

document.getElementById('showDemoWeather').addEventListener('click', () => {
  renderWeatherTilesFromApi(demoWeather);
});

// ---- AI Assistant logic ----
const assistantMessages = document.getElementById('assistantMessages');
const assistantInput = document.getElementById('assistantInput');
const assistantSend = document.getElementById('assistantSend');
const assistantSuggestPlantsBtn = document.getElementById('assistantSuggestPlants');
const assistantSeason = document.getElementById('assistantSeason');
const assistantUseLocation = document.getElementById('assistantUseLocation');
const assistantSuggestKitBtn = document.getElementById('assistantSuggestKit');

function appendAssistantMessage(text, who = 'assistant') {
  if (!assistantMessages) return;
  const div = document.createElement('div');
  div.className = `assistant-message ${who}`;

  // message layout: optional icon + text
  const icon = document.createElement('div');
  icon.className = 'msg-icon';
  if (who === 'assistant') {
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#0f9d58"/><path d="M8 12c0-2 2-4 4-4s4 2 4 4-2 4-4 4-4-2-4-4z" fill="#fff" opacity="0.95"/></svg>`;
  } else {
    // simple user icon
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3" fill="#4f7cff"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6" fill="#4f7cff" opacity="0.12"/></svg>`;
  }

  const txt = document.createElement('div');
  txt.className = 'msg-text';
  txt.textContent = text;

  div.appendChild(icon);
  div.appendChild(txt);
  assistantMessages.appendChild(div);
  assistantMessages.scrollTop = assistantMessages.scrollHeight;
}

async function handleAssistantQuery(text) {
  appendAssistantMessage(text, 'user');
  const q = (text || '').toLowerCase();

  // If user asks to run prediction, trigger existing predict flow
  if (q.includes('predict') || q.includes('run prediction') || q.includes('prediction')) {
    appendAssistantMessage('Running prediction...');
    predictBtn.click();
    setTimeout(() => {
      appendAssistantMessage(confidenceText.textContent || 'Prediction complete.');
    }, 300);
    return;
  }

  // If user asks for recommendations/advice, use current disaster type and confidence
  if (q.includes('recommend') || q.includes('advice') || q.includes('what should')) {
    let conf = 0.5;
    const match = (confidenceText.textContent || '').match(/([0-9]+\.?[0-9]*)%/);
    if (match) conf = parseFloat(match[1]) / 100;
    const type = document.getElementById('disasterType').value;
    const hours = parseInt(timeRange.value, 10);
    const recs = getRecommendations(type, conf, { hours });
    if (recs.length === 0) {
      appendAssistantMessage('No specific recommendations available. Try running a prediction first.', 'assistant');
    } else {
      appendAssistantMessage('Recommendations: ' + recs.join(' • '), 'assistant');
    }
    return;
  }

  // Local gardening knowledge is handled by the more flexible plant handler below.
  // More flexible: if user asks about plants in general, use selected season & location
  if (/\b(plant|plants|grow|gardening)\b/i.test(q)) {
    const seasonEl = assistantSeason ? assistantSeason.value : null;
    const useLoc = assistantUseLocation ? assistantUseLocation.checked : false;
    const seasonMatch = q.match(/summer|monsoon|winter|rainy|hot|cold/i);
    const season = seasonMatch ? (seasonMatch[0].toLowerCase().includes('rain') ? 'monsoon' : seasonMatch[0].toLowerCase()) : (seasonEl || 'summer');
    const place = (useLoc ? (document.getElementById('location').value || '').trim() : '') || 'your area';
    const suggestion = generatePlantSuggestionForSeason(season, place);
    appendAssistantMessage(suggestion, 'assistant');
    return;
  }

  // Otherwise give a helpful summary about current state
  // For other free-form queries, call the server-side assistant (OpenAI) if available
  appendAssistantMessage('Thinking...', 'assistant');
  const placeholderIdx = assistantMessages.children.length - 1;
  try {
    const r = await fetch('/api/assistant', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text })
    });

    // Be defensive: server may return non-JSON (HTML error pages) or an empty body.
    const ct = r.headers.get('content-type') || '';
    let j = null;
    if (ct.includes('application/json')) {
      try {
        j = await r.json();
      } catch (e) {
        // malformed JSON
        j = { ok: false, error: 'Malformed JSON response from server' };
      }
    } else {
      // fallback: read as text and try to parse if it looks like JSON
      const txt = await r.text();
      if (!txt) {
        j = { ok: false, error: `Empty response from server (status ${r.status})` };
      } else {
        try {
          j = JSON.parse(txt);
        } catch (e) {
          j = { ok: false, error: `Non-JSON response (status ${r.status}): ${txt.slice(0, 200)}` };
        }
      }
    }

    // remove the 'Thinking...' placeholder and replace with real reply
    if (assistantMessages.children[placeholderIdx]) assistantMessages.children[placeholderIdx].remove();
    if (j && j.ok && j.reply) appendAssistantMessage(j.reply, 'assistant');
    else appendAssistantMessage(`Assistant error: ${j && j.error ? j.error : 'No reply'}`, 'assistant');
  } catch (err) {
    if (assistantMessages.children[placeholderIdx]) assistantMessages.children[placeholderIdx].remove();
    appendAssistantMessage(`Assistant request failed: ${err && err.message ? err.message : err}`, 'assistant');
  }
  return;
}

if (assistantSend && assistantInput) {
  assistantSend.addEventListener('click', () => {
    const text = assistantInput.value.trim();
    if (!text) return;
    assistantInput.value = '';
    handleAssistantQuery(text);
  });
  assistantInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { assistantSend.click(); }
  });
  // initial greeting
  appendAssistantMessage('Hi — I am the local AI assistant. Ask me to run a prediction or request recommendations for the selected disaster type.');
}

// Quick suggestion handlers
if (assistantSuggestPlantsBtn) {
  assistantSuggestPlantsBtn.addEventListener('click', () => {
    const season = assistantSeason ? assistantSeason.value : 'summer';
    const useLoc = assistantUseLocation ? assistantUseLocation.checked : false;
    const place = (useLoc ? (document.getElementById('location').value || '').trim() : '') || 'your area';
    const answer = generatePlantSuggestionForSeason(season, place);
    appendAssistantMessage(answer, 'assistant');
  });
}

if (assistantSuggestKitBtn) {
  assistantSuggestKitBtn.addEventListener('click', () => {
    const kit = `Emergency kit checklist (basic):\n\n- Water: 3 litres per person per day for 3 days.\n- Food: non-perishable items (canned food, energy bars) for 3 days.\n- First aid kit: bandages, antiseptic, pain relief, prescription meds.\n- Tools: torch, spare batteries, multi-tool, whistle.\n- Documents: copies of IDs, insurance, important contacts in a waterproof bag.\n- Hygiene: wet wipes, hand sanitizer, toilet paper.\n- Misc: phone power bank, cash, local maps, spare clothes, blanket.`;
    appendAssistantMessage(kit, 'assistant');
  });
}
