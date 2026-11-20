import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, LiveServerMessage, Modality, ThinkingLevel, Type } from '@google/genai';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '15mb' }));

// In-Memory & File backed feedback store for Jugend-forscht evaluation questions
interface FeedbackEntry {
  id: string;
  timestamp: string;
  stichwort?: string;
  einsatzort?: string;
  durationSeconds?: number;
  overallRating: 'gut' | 'verbesserung' | null;
  criteria: {
    verstaendlichkeit: boolean;
    schnelligkeit: boolean;
    korrekteKraefte: boolean;
    realistisch: boolean;
    einsatzstichwortTreffend: boolean;
    fuenfWReihenfolge: boolean;
    nachalarmierungFunktioniert: boolean;
    anweisungenVerstaendlich: boolean;
  };
  comment: string;
}

const FEEDBACK_FILE = path.join(process.cwd(), 'evaluations.json');
let feedbacks: FeedbackEntry[] = [];

try {
  if (fs.existsSync(FEEDBACK_FILE)) {
    const raw = fs.readFileSync(FEEDBACK_FILE, 'utf-8');
    feedbacks = JSON.parse(raw);
  }
} catch (e) {
  console.warn('Could not read existing feedback file, starting with empty store');
}

function saveFeedbacksToFile() {
  try {
    fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(feedbacks, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write feedbacks to file:', e);
  }
}

// API to save user feedback
app.post('/api/feedback/submit', (req, res) => {
  try {
    const body = req.body;
    const newEntry: FeedbackEntry = {
      id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      stichwort: body.stichwort || 'Feuerwehreinsatz',
      einsatzort: body.einsatzort || 'Kiel',
      durationSeconds: body.durationSeconds || 0,
      overallRating: body.overallRating || null,
      criteria: body.criteria || {
        verstaendlichkeit: false,
        schnelligkeit: false,
        korrekteKraefte: false,
        realistisch: false,
        einsatzstichwortTreffend: false,
        fuenfWReihenfolge: false,
        nachalarmierungFunktioniert: false,
        anweisungenVerstaendlich: false,
      },
      comment: body.comment || '',
    };
    feedbacks.unshift(newEntry);
    saveFeedbacksToFile();
    return res.json({ success: true, count: feedbacks.length });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to save feedback', message: err.message });
  }
});

// API to verify password and view feedback entries
app.post('/api/feedback/list', (req, res) => {
  const { password } = req.body;
  if (password !== 'jfprofis') {
    return res.status(401).json({ error: 'Falsches Passwort', authorized: false });
  }
  return res.json({ authorized: true, feedbacks });
});

// Initialize Gemini Client
let ai: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!ai && process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return ai;
}

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Worldwide and Regional Geolocation Dictionary
interface GeoResult {
  lat: number;
  lng: number;
  city: string;
  displayName: string;
  country: string;
}

const CITY_COORDINATES: Record<string, { lat: number; lng: number; city: string; country: string }> = {
  berlin: { lat: 52.5200, lng: 13.4050, city: 'Berlin', country: 'Deutschland' },
  hamburg: { lat: 53.5511, lng: 9.9937, city: 'Hamburg', country: 'Deutschland' },
  münchen: { lat: 48.1351, lng: 11.5820, city: 'München', country: 'Deutschland' },
  muenchen: { lat: 48.1351, lng: 11.5820, city: 'München', country: 'Deutschland' },
  köln: { lat: 50.9375, lng: 6.9603, city: 'Köln', country: 'Deutschland' },
  koeln: { lat: 50.9375, lng: 6.9603, city: 'Köln', country: 'Deutschland' },
  frankfurt: { lat: 50.1109, lng: 8.6821, city: 'Frankfurt am Main', country: 'Deutschland' },
  stuttgart: { lat: 48.7758, lng: 9.1829, city: 'Stuttgart', country: 'Deutschland' },
  düsseldorf: { lat: 51.2277, lng: 6.7735, city: 'Düsseldorf', country: 'Deutschland' },
  duesseldorf: { lat: 51.2277, lng: 6.7735, city: 'Düsseldorf', country: 'Deutschland' },
  leipzig: { lat: 51.3397, lng: 12.3731, city: 'Leipzig', country: 'Deutschland' },
  dortmund: { lat: 51.5136, lng: 7.4653, city: 'Dortmund', country: 'Deutschland' },
  essen: { lat: 51.4556, lng: 7.0116, city: 'Essen', country: 'Deutschland' },
  bremen: { lat: 53.0793, lng: 8.8017, city: 'Bremen', country: 'Deutschland' },
  dresden: { lat: 51.0504, lng: 13.7373, city: 'Dresden', country: 'Deutschland' },
  hannover: { lat: 52.3759, lng: 9.7320, city: 'Hannover', country: 'Deutschland' },
  nürnberg: { lat: 49.4521, lng: 11.0767, city: 'Nürnberg', country: 'Deutschland' },
  nuernberg: { lat: 49.4521, lng: 11.0767, city: 'Nürnberg', country: 'Deutschland' },
  duisburg: { lat: 51.4344, lng: 6.7623, city: 'Duisburg', country: 'Deutschland' },
  bochum: { lat: 51.4818, lng: 7.2162, city: 'Bochum', country: 'Deutschland' },
  wuppertal: { lat: 51.2562, lng: 7.1508, city: 'Wuppertal', country: 'Deutschland' },
  bielefeld: { lat: 52.0302, lng: 8.5325, city: 'Bielefeld', country: 'Deutschland' },
  bonn: { lat: 50.7374, lng: 7.0982, city: 'Bonn', country: 'Deutschland' },
  münster: { lat: 51.9607, lng: 7.6261, city: 'Münster', country: 'Deutschland' },
  muenster: { lat: 51.9607, lng: 7.6261, city: 'Münster', country: 'Deutschland' },
  karlsruhe: { lat: 49.0069, lng: 8.4037, city: 'Karlsruhe', country: 'Deutschland' },
  mannheim: { lat: 49.4875, lng: 8.4660, city: 'Mannheim', country: 'Deutschland' },
  augsburg: { lat: 48.3705, lng: 10.8978, city: 'Augsburg', country: 'Deutschland' },
  wiesbaden: { lat: 50.0782, lng: 8.2398, city: 'Wiesbaden', country: 'Deutschland' },
  gelsenkirchen: { lat: 51.5177, lng: 7.0857, city: 'Gelsenkirchen', country: 'Deutschland' },
  mönchengladbach: { lat: 51.1805, lng: 6.4428, city: 'Mönchengladbach', country: 'Deutschland' },
  braunschweig: { lat: 52.2689, lng: 10.5268, city: 'Braunschweig', country: 'Deutschland' },
  chemnitz: { lat: 50.8278, lng: 12.9214, city: 'Chemnitz', country: 'Deutschland' },
  kiel: { lat: 54.3233, lng: 10.1228, city: 'Kiel', country: 'Deutschland' },
  aachen: { lat: 50.7753, lng: 6.0839, city: 'Aachen', country: 'Deutschland' },
  halle: { lat: 51.4828, lng: 11.9698, city: 'Halle (Saale)', country: 'Deutschland' },
  magdeburg: { lat: 52.1205, lng: 11.6276, city: 'Magdeburg', country: 'Deutschland' },
  freiburg: { lat: 47.9990, lng: 7.8421, city: 'Freiburg', country: 'Deutschland' },
  krefeld: { lat: 51.3333, lng: 6.5667, city: 'Krefeld', country: 'Deutschland' },
  lübeck: { lat: 53.8655, lng: 10.6866, city: 'Lübeck', country: 'Deutschland' },
  mainz: { lat: 49.9929, lng: 8.2473, city: 'Mainz', country: 'Deutschland' },
  erfurt: { lat: 50.9848, lng: 11.0299, city: 'Erfurt', country: 'Deutschland' },
  oberhausen: { lat: 51.4782, lng: 6.8661, city: 'Oberhausen', country: 'Deutschland' },
  rostock: { lat: 54.0924, lng: 12.0991, city: 'Rostock', country: 'Deutschland' },
  kassel: { lat: 51.3127, lng: 9.4797, city: 'Kassel', country: 'Deutschland' },
  saarbrücken: { lat: 49.2402, lng: 6.9969, city: 'Saarbrücken', country: 'Deutschland' },
  potsdam: { lat: 52.3906, lng: 13.0645, city: 'Potsdam', country: 'Deutschland' },
  heidelberg: { lat: 49.3988, lng: 8.6724, city: 'Heidelberg', country: 'Deutschland' },
  darmstadt: { lat: 49.8728, lng: 8.6512, city: 'Darmstadt', country: 'Deutschland' },
  regensburg: { lat: 49.0134, lng: 12.1016, city: 'Regensburg', country: 'Deutschland' },
  würzburg: { lat: 49.7913, lng: 9.9534, city: 'Würzburg', country: 'Deutschland' },
  ulm: { lat: 48.4011, lng: 9.9876, city: 'Ulm', country: 'Deutschland' },
  heilbronn: { lat: 49.1427, lng: 9.2109, city: 'Heilbronn', country: 'Deutschland' },
  göttingen: { lat: 51.5413, lng: 9.9158, city: 'Göttingen', country: 'Deutschland' },
  trier: { lat: 49.7561, lng: 6.6414, city: 'Trier', country: 'Deutschland' },
  jena: { lat: 50.9271, lng: 11.5892, city: 'Jena', country: 'Deutschland' },
  flensburg: { lat: 54.7836, lng: 9.4321, city: 'Flensburg', country: 'Deutschland' },
  konstanz: { lat: 47.6779, lng: 9.1732, city: 'Konstanz', country: 'Deutschland' },
  wien: { lat: 48.2082, lng: 16.3738, city: 'Wien', country: 'Österreich' },
  graz: { lat: 47.0707, lng: 15.4395, city: 'Graz', country: 'Österreich' },
  linz: { lat: 48.3069, lng: 14.2858, city: 'Linz', country: 'Österreich' },
  salzburg: { lat: 47.8095, lng: 13.0550, city: 'Salzburg', country: 'Österreich' },
  innsbruck: { lat: 47.2692, lng: 11.4041, city: 'Innsbruck', country: 'Österreich' },
  zürich: { lat: 47.3769, lng: 8.5417, city: 'Zürich', country: 'Schweiz' },
  zuerich: { lat: 47.3769, lng: 8.5417, city: 'Zürich', country: 'Schweiz' },
  bern: { lat: 46.9480, lng: 7.4474, city: 'Bern', country: 'Schweiz' },
  basel: { lat: 47.5596, lng: 7.5886, city: 'Basel', country: 'Schweiz' },
  genf: { lat: 46.2044, lng: 6.1432, city: 'Genf', country: 'Schweiz' },
  london: { lat: 51.5074, lng: -0.1278, city: 'London', country: 'Großbritannien' },
  paris: { lat: 48.8566, lng: 2.3522, city: 'Paris', country: 'Frankreich' },
  rom: { lat: 41.9028, lng: 12.4964, city: 'Rom', country: 'Italien' },
  madrid: { lat: 40.4168, lng: -3.7038, city: 'Madrid', country: 'Spanien' },
  amsterdam: { lat: 52.3676, lng: 4.9041, city: 'Amsterdam', country: 'Niederlande' },
  brüssel: { lat: 50.8503, lng: 4.3517, city: 'Brüssel', country: 'Belgien' },
  newyork: { lat: 40.7128, lng: -74.0060, city: 'New York', country: 'USA' },
  tokyo: { lat: 35.6762, lng: 139.6503, city: 'Tokio', country: 'Japan' },
  sydney: { lat: -33.8688, lng: 151.2093, city: 'Sydney', country: 'Australien' },
};

const KIEL_KNOWN_LOCATIONS: Record<string, { lat: number; lng: number; displayName: string }> = {
  holstenstraße: { lat: 54.3225, lng: 10.1345, displayName: 'Holstenstraße, 24103 Kiel' },
  holstenstr: { lat: 54.3225, lng: 10.1345, displayName: 'Holstenstraße, 24103 Kiel' },
  sophienhof: { lat: 54.3160, lng: 10.1320, displayName: 'Sophienhof (Sophienblatt 20), 24103 Kiel' },
  hauptbahnhof: { lat: 54.3155, lng: 10.1325, displayName: 'Kiel Hauptbahnhof, 24103 Kiel' },
  bahnhof: { lat: 54.3155, lng: 10.1325, displayName: 'Kiel Hauptbahnhof, 24103 Kiel' },
  rathaus: { lat: 54.3230, lng: 10.1350, displayName: 'Rathausplatz, 24103 Kiel' },
  rathausplatz: { lat: 54.3230, lng: 10.1350, displayName: 'Rathausplatz, 24103 Kiel' },
  fleethörn: { lat: 54.3228, lng: 10.1330, displayName: 'Fleethörn, 24103 Kiel' },
  westring: { lat: 54.3350, lng: 10.1180, displayName: 'Westring, 24118 Kiel' },
  knooper: { lat: 54.3310, lng: 10.1270, displayName: 'Knooper Weg, 24116 Kiel' },
  bergstraße: { lat: 54.3270, lng: 10.1360, displayName: 'Bergstraße, 24103 Kiel' },
  bergstr: { lat: 54.3270, lng: 10.1360, displayName: 'Bergstraße, 24103 Kiel' },
  feldstraße: { lat: 54.3380, lng: 10.1430, displayName: 'Feldstraße, 24105 Kiel' },
  feldstr: { lat: 54.3380, lng: 10.1430, displayName: 'Feldstraße, 24105 Kiel' },
  werftstraße: { lat: 54.3128, lng: 10.1465, displayName: 'Werftstraße, 24143 Kiel' },
  werftstr: { lat: 54.3128, lng: 10.1465, displayName: 'Werftstraße, 24143 Kiel' },
  preetzer: { lat: 54.3060, lng: 10.1420, displayName: 'Preetzer Straße, 24143 Kiel' },
  olshausenstraße: { lat: 54.3460, lng: 10.1180, displayName: 'Olshausenstraße (Universität), 24118 Kiel' },
  universität: { lat: 54.3460, lng: 10.1180, displayName: 'Christian-Albrechts-Universität, 24118 Kiel' },
  uni: { lat: 54.3460, lng: 10.1180, displayName: 'Christian-Albrechts-Universität, 24118 Kiel' },
  steenbeker: { lat: 54.3601, lng: 10.1032, displayName: 'Steenbeker Weg, 24106 Kiel' },
  gaarden: { lat: 54.3130, lng: 10.1480, displayName: 'Kiel-Gaarden, 24143 Kiel' },
  suchsdorf: { lat: 54.3540, lng: 10.0760, displayName: 'Kiel-Suchsdorf, 24107 Kiel' },
  elmschenhagen: { lat: 54.2980, lng: 10.1800, displayName: 'Kiel-Elmschenhagen, 24146 Kiel' },
  holtenauer: { lat: 54.3400, lng: 10.1320, displayName: 'Holtenauer Straße, 24105 Kiel' },
  kiellinie: { lat: 54.3300, lng: 10.1500, displayName: 'Kiellinie, 24105 Kiel' },
  schauenburger: { lat: 54.3325, lng: 10.1310, displayName: 'Schauenburgerstraße, 24118 Kiel' },
  illerweg: { lat: 54.3412, lng: 10.0985, displayName: 'Illerweg, 24107 Kiel' },
};

async function geocodeLocation(rawText: string, contextCity: string | null = 'Kiel'): Promise<GeoResult | null> {
  if (!rawText || rawText.trim().length === 0 || rawText === 'Wird erfragt' || rawText === 'Stadt wird erfragt' || rawText === 'Straße in Kiel wird erfragt') {
    return null;
  }

  let queryText = rawText.trim();

  // Strip conversational German filler phrases that callers typically use
  queryText = queryText
    .replace(/^(hallo|guten tag|notruf|hilfe|hier|ich bin|wir sind|notfall|es brennt|unfall|feuer|brand)\s+/gi, '')
    .replace(/\b(hier brennt es in der|es brennt in der|wir sind in der|ich bin in der|befinde mich in der|an der|in der|auf der|am|im|bei|vor der|in)\s+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const cleanedLower = queryText.toLowerCase().replace(/[.,!?;:()]/g, ' ');

  // Direct instant check for known Kiel streets and landmarks
  for (const [key, loc] of Object.entries(KIEL_KNOWN_LOCATIONS)) {
    if (cleanedLower.includes(key)) {
      // Check if house number was present in query
      const hnrMatch = cleanedLower.match(new RegExp(`${key}[\\s,]+(\\d+[a-z]?)`, 'i'));
      let disp = loc.displayName;
      if (hnrMatch && hnrMatch[1]) {
        // e.g. "Illerweg 10, 24107 Kiel"
        disp = loc.displayName.replace(/^([^,]+)(.*)$/, `$1 ${hnrMatch[1]}$2`);
      }
      return {
        lat: loc.lat,
        lng: loc.lng,
        city: 'Kiel',
        displayName: disp,
        country: 'Deutschland',
      };
    }
  }

  // Ensure Kiel context is appended
  const effContext = contextCity || 'Kiel';
  if (!queryText.toLowerCase().includes(effContext.toLowerCase())) {
    queryText = `${queryText}, ${effContext}`;
  }

  const words = cleanedLower.split(/\s+/).filter(Boolean);

  // Check if specific street name, number, building, or address components are present
  const hasSpecificStreet = (
    /straße|strasse|str\b|str\.|weg\b|gasse\b|platz\b|allee\b|damm\b|ring\b|ufer\b|chaussee\b|markt\b|pfad\b|tor\b|brücke\b|schule\b|hospital\b|klinik\b/i.test(queryText) ||
    /\b\d{1,4}\b/.test(queryText) ||
    queryText.includes(',')
  );

  // 1. If a specific street, house number or address is indicated:
  // Query OpenStreetMap Nominatim FIRST for the exact street / building coordinates!
  if (hasSpecificStreet) {
    try {
      const encoded = encodeURIComponent(queryText);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3400);
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encoded}&limit=1`,
        {
          signal: controller.signal,
          headers: {
            'User-Agent': 'FeuerwehrLeitstelleApp/1.0 (emergency-dispatch-demo; contact: leitstelle112)',
          },
        }
      );
      clearTimeout(timeout);
      if (resp.ok) {
        const data = (await resp.json()) as any[];
        if (data && data.length > 0) {
          const item = data[0];
          const lat = parseFloat(item.lat);
          const lng = parseFloat(item.lon);
          const addr = item.address || {};
          const detectedCity = addr.city || addr.town || addr.village || addr.municipality || 'Kiel';
          const road = addr.road || addr.pedestrian || addr.street || '';
          const houseNumber = addr.house_number || '';
          const postcode = addr.postcode || '24103';

          let formattedName = item.display_name || queryText;
          if (road) {
            formattedName = `${road}${houseNumber ? ' ' + houseNumber : ''}, ${postcode} ${detectedCity}`;
          }

          return {
            lat,
            lng,
            city: detectedCity,
            displayName: formattedName,
            country: addr.country || 'Deutschland',
          };
        }
      }
    } catch (err) {
      console.warn('Nominatim street search timed out or failed:', err);
    }
  }

  // Fallback to center of Kiel if location could not be pinpointed
  return {
    lat: 54.3233,
    lng: 10.1228,
    city: 'Kiel',
    displayName: `${queryText}`,
    country: 'Deutschland',
  };
}

// Real Fire and Rescue Stations in Kiel
const KIEL_STATIONS = {
  hauptfeuerwache: { lat: 54.3312, lng: 10.1197, name: 'Hauptfeuerwache Kiel (Wache 1, Westring)' },
  ostwache: { lat: 54.3128, lng: 10.1465, name: 'Feuerwache 2 Kiel (Werftstraße, Gaarden)' },
  rwMitte: { lat: 54.3215, lng: 10.1080, name: 'Rettungswache Kiel-Mitte (Kronshagener Weg)' },
  rwGaarden: { lat: 54.3060, lng: 10.1420, name: 'Rettungswache Gaarden (Preetzer Straße)' },
  rwUksh: { lat: 54.3365, lng: 10.1380, name: 'Rettungswache UKSH Campus Kiel' },
  rwSteenbek: { lat: 54.3601, lng: 10.1032, name: 'Rettungswache Steenbek / Suchsdorf' },
  nefKrankenhaus: { lat: 54.3255, lng: 10.1150, name: 'Notarztstandort Städtisches Krankenhaus Kiel' },
};

// In-memory cache for street routes to avoid duplicate OSRM calls
const roadRouteCache = new Map<string, Array<[number, number]>>();

/**
 * Fetches turn-by-turn road driving route from OSRM API so vehicles travel along actual streets.
 */
async function fetchRoadRoute(
  startLat: number,
  startLng: number,
  targetLat: number,
  targetLng: number
): Promise<Array<[number, number]>> {
  const cacheKey = `${startLat.toFixed(4)},${startLng.toFixed(4)}_${targetLat.toFixed(4)},${targetLng.toFixed(4)}`;
  if (roadRouteCache.has(cacheKey)) {
    return roadRouteCache.get(cacheKey)!;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2400);
    const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${targetLng},${targetLat}?overview=full&geometries=geojson`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (resp.ok) {
      const data = (await resp.json()) as any;
      const coords = data.routes?.[0]?.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length > 1) {
        // GeoJSON gives [lng, lat], map to Leaflet [lat, lng]
        const latLngs: Array<[number, number]> = coords.map((c: [number, number]) => [
          Number(c[1].toFixed(6)),
          Number(c[0].toFixed(6)),
        ]);
        roadRouteCache.set(cacheKey, latLngs);
        return latLngs;
      }
    }
  } catch (err) {
    console.warn('OSRM routing fetch failed or timed out:', err);
  }

  // Fallback road corridor in Kiel via intermediate street junctions
  const midLat = (startLat + targetLat) / 2;
  const midLng = (startLng + targetLng) / 2;
  const fallbackRoute: Array<[number, number]> = [
    [startLat, startLng],
    [midLat + 0.001, midLng - 0.001],
    [targetLat, targetLng],
  ];
  roadRouteCache.set(cacheKey, fallbackRoute);
  return fallbackRoute;
}

async function assignVehicleCoordinates(units: any[], geo: GeoResult): Promise<any[]> {
  const mappedUnits = units.map((unit, idx) => {
    let stationLat = KIEL_STATIONS.hauptfeuerwache.lat;
    let stationLng = KIEL_STATIONS.hauptfeuerwache.lng;
    let stationName = KIEL_STATIONS.hauptfeuerwache.name;

    if (unit.type === 'RTW') {
      const rtwIdx = idx % 4;
      if (rtwIdx === 0) {
        stationLat = KIEL_STATIONS.rwMitte.lat;
        stationLng = KIEL_STATIONS.rwMitte.lng;
        stationName = KIEL_STATIONS.rwMitte.name;
      } else if (rtwIdx === 1) {
        stationLat = KIEL_STATIONS.rwGaarden.lat;
        stationLng = KIEL_STATIONS.rwGaarden.lng;
        stationName = KIEL_STATIONS.rwGaarden.name;
      } else if (rtwIdx === 2) {
        stationLat = KIEL_STATIONS.rwUksh.lat;
        stationLng = KIEL_STATIONS.rwUksh.lng;
        stationName = KIEL_STATIONS.rwUksh.name;
      } else {
        stationLat = KIEL_STATIONS.rwSteenbek.lat;
        stationLng = KIEL_STATIONS.rwSteenbek.lng;
        stationName = KIEL_STATIONS.rwSteenbek.name;
      }
    } else if (unit.type === 'NEF') {
      stationLat = KIEL_STATIONS.nefKrankenhaus.lat;
      stationLng = KIEL_STATIONS.nefKrankenhaus.lng;
      stationName = KIEL_STATIONS.nefKrankenhaus.name;
    } else {
      // Fire engines: alternate between Hauptfeuerwache and Ostfeuerwache in Kiel
      if (idx % 2 === 1) {
        stationLat = KIEL_STATIONS.ostwache.lat;
        stationLng = KIEL_STATIONS.ostwache.lng;
        stationName = KIEL_STATIONS.ostwache.name;
      }
    }

    const eta = unit.etaMinutes && unit.etaMinutes >= 3 && unit.etaMinutes <= 4
      ? unit.etaMinutes
      : 3 + (idx % 2);

    return {
      ...unit,
      station: stationName,
      etaMinutes: eta,
      statusText: `Status 3 - Sondersignal (${eta} min)`,
      startLat: stationLat,
      startLng: stationLng,
      currentLat: stationLat,
      currentLng: stationLng,
      targetLat: geo.lat,
      targetLng: geo.lng,
    };
  });

  // Query street routes in parallel for unique station locations to follow actual streets
  const uniqueStationCoords = Array.from(new Set(mappedUnits.map((u) => `${u.startLat},${u.startLng}`)));
  const stationRoutes = new Map<string, Array<[number, number]>>();

  await Promise.all(
    uniqueStationCoords.map(async (coordStr) => {
      const [sLat, sLng] = coordStr.split(',').map(Number);
      const roadPath = await fetchRoadRoute(sLat, sLng, geo.lat, geo.lng);
      stationRoutes.set(coordStr, roadPath);
    })
  );

  return mappedUnits.map((u) => ({
    ...u,
    routePath: stationRoutes.get(`${u.startLat},${u.startLng}`) || [
      [u.startLat, u.startLng],
      [geo.lat, geo.lng],
    ],
  }));
}

function extractInjuredCount(text: string): number | null {
  let lower = text.toLowerCase();

  // Strip street names with house numbers FIRST so that addresses like "Illerweg 10", "Holstenstraße 12", etc.
  // are NOT mistaken for injured patient counts!
  lower = lower.replace(
    /([a-zäöüß.\- ]{2,30}?(?:straße|strasse|str\b|str\.|weg\b|gasse\b|platz\b|allee\b|damm\b|ring\b|ufer\b|chaussee\b|markt\b|pfad\b))\s+(\d+[a-z]?)\b/gi,
    ' '
  );
  // Also strip "hausnummer 10", "hnr 10", "nr. 10"
  lower = lower.replace(/(?:hausnummer|hnr\.?|nr\.?)\s*\d+[a-z]?\b/gi, ' ');

  if (
    lower.includes('keine verletzte') ||
    lower.includes('keine verletzten') ||
    lower.includes('niemand verletzt') ||
    lower.includes('keiner verletzt') ||
    lower.includes('keine person verletzt') ||
    lower.includes('0 verletzte') ||
    lower.includes('niemand ist verletzt') ||
    lower.includes('keine person zu schaden')
  ) {
    return 0;
  }

  // 1. Explicit digits with keywords: "100 Verletzte", "2 Lehrer vermisst", "2 vermisste", etc.
  const digitMatch = lower.match(/(\d+)\s*(?:personen|menschen|verletzte[n]?|schwerverletzte[n]?|leichtverletzte[n]?|patienten|schüler[n]?|kinder[n]?|insassen|opfer[n]?|beteiligte[n]?|lehrer[n]?|vermisste[n]?|leute|betroffene[n]?|rtws?)/i);
  if (digitMatch && digitMatch[1]) {
    return parseInt(digitMatch[1], 10);
  }

  // Vermisst / eingeschlossen mit Ziffer davor oder danach (z. B. "2 Lehrer werden noch vermisst", "vermisst werden 2")
  const vermisstMatch = lower.match(/(?:vermisst|eingeschlossen|in gefahr)[^\d]{0,25}(\d+)/i) || lower.match(/(\d+)[^\d]{0,25}(?:vermisst|eingeschlossen|in gefahr)/i);
  if (vermisstMatch) {
    const val = parseInt(vermisstMatch[1], 10);
    if (val > 0) return val;
  }

  // 2. German word numbers (including Lehrer, Vermisste, etc.)
  const numberWords: [RegExp, number][] = [
    [/\b(hundert|100)\b/i, 100],
    [/\b(fünfzig|50)\b/i, 50],
    [/\b(vierzig|40)\b/i, 40],
    [/\b(dreißig|30)\b/i, 30],
    [/\b(zwanzig|20)\b/i, 20],
    [/\b(fünfzehn|15)\b/i, 15],
    [/\b(zwölf|12)\b/i, 12],
    [/\b(zehn|10)\s*(?:personen|menschen|verletzte[n]?|schwerverletzte[n]?|patienten|schüler[n]?|kinder[n]?|lehrer[n]?|vermisste[n]?|insassen|opfer)?\b/i, 10],
    [/\b(neun|9)\s*(?:personen|menschen|verletzte[n]?|schwerverletzte[n]?|patienten|schüler[n]?|kinder[n]?|lehrer[n]?|vermisste[n]?|insassen|opfer)?\b/i, 9],
    [/\b(acht|8)\s*(?:personen|menschen|verletzte[n]?|schwerverletzte[n]?|patienten|schüler[n]?|kinder[n]?|lehrer[n]?|vermisste[n]?|insassen|opfer)?\b/i, 8],
    [/\b(sieben|7)\s*(?:personen|menschen|verletzte[n]?|schwerverletzte[n]?|patienten|schüler[n]?|kinder[n]?|lehrer[n]?|vermisste[n]?|insassen|opfer)?\b/i, 7],
    [/\b(sechs|6)\s*(?:personen|menschen|verletzte[n]?|schwerverletzte[n]?|patienten|schüler[n]?|kinder[n]?|lehrer[n]?|vermisste[n]?|insassen|opfer)?\b/i, 6],
    [/\b(fünf|5)\s*(?:personen|menschen|verletzte[n]?|schwerverletzte[n]?|patienten|schüler[n]?|kinder[n]?|lehrer[n]?|vermisste[n]?|insassen|opfer)?\b/i, 5],
    [/\b(vier|4)\s*(?:personen|menschen|verletzte[n]?|schwerverletzte[n]?|patienten|schüler[n]?|kinder[n]?|lehrer[n]?|vermisste[n]?|insassen|opfer)?\b/i, 4],
    [/\b(drei|3)\s*(?:personen|menschen|verletzte[n]?|schwerverletzte[n]?|patienten|schüler[n]?|kinder[n]?|lehrer[n]?|vermisste[n]?|insassen|opfer)?\b/i, 3],
    [/\b(zwei|beide|2)\s*(?:personen|menschen|verletzte[n]?|schwerverletzte[n]?|patienten|schüler[n]?|kinder[n]?|lehrer[n]?|vermisste[n]?|insassen|opfer)?\b/i, 2],
    [/\b(ein|eine|einer|einen|einem|eines|1)\s+(?:person|mensch|verletzter?|patient|schüler|kind|lehrer|vermisster?|insasse|opfer)\b/i, 1],
  ];

  for (const [pattern, num] of numberWords) {
    if (pattern.test(lower)) {
      return num;
    }
  }

  // Also check verbal phrases like "zwei lehrer vermisst" or "zwei lehrer werden noch vermisst"
  if (lower.includes('zwei lehrer') || lower.includes('2 lehrer') || lower.includes('beide lehrer')) {
    return 2;
  }
  if (lower.includes('drei lehrer') || lower.includes('3 lehrer')) {
    return 3;
  }
  if (lower.includes('ein lehrer') || lower.includes('1 lehrer') || lower.includes('eine lehrerin')) {
    return 1;
  }

  // 3. Explicit count answering phrases (e.g. "es gibt 5", "wir sind 4", "es sind ca. 100", "5 verletzte")
  const explicitCountMatch = lower.match(/(?:es gibt|wir haben|es sind|sind|ca\.?|etwa|rund|noch|fehlen)\s+(\d+)\b/i);
  if (explicitCountMatch && explicitCountMatch[1]) {
    const parsed = parseInt(explicitCountMatch[1], 10);
    if (parsed > 0) {
      return parsed;
    }
  }

  // Exact standalone single number in short answer message (e.g. user just replies "2" or "100")
  const trimmed = lower.trim();
  if (/^\d{1,4}$/.test(trimmed)) {
    const parsed = parseInt(trimmed, 10);
    if (parsed > 0) return parsed;
  }

  if (lower.includes('mehrere verletzte') || lower.includes('viele verletzte') || lower.includes('mehrere vermisst')) {
    return 3;
  }

  return null;
}

function calculateRtwFleetCount(category: string, injuredCount: number | null): number {
  // Disponenten-Regel laut Vorgabe:
  // - Bei kleineren Einsätzen (z. B. Zimmerbrand oder Kleinlage), wo z. B. 2 Personen vermisst/verletzt sind: EXAKT 2 RTWs entsenden (kein unpassender Massen-Overkill).
  // - Bei Brandeinsätzen ohne Verletzte: 1 RTW zur Eigensicherung der Atemschutztrupps.
  // - Bei großen Einsätzen (z. B. Schule, Großbrand, Massenanfall) mit Puffer planen:
  //   z.B. wenn 2 vermisst/verletzt bei einem Schul-Großbrand gemeldet sind: 2 RTWs + Puffer (z.B. +1 bis +2 Puffer-RTW = 3 bis 4 RTWs, statt 10 oder 20).
  //   wenn 10 gemeldet sind: ca. 12 RTWs (+20% Puffer).
  //   wenn 100 gemeldet sind: 100-110 RTWs.
  const isLargeIncident = (category === 'school_fire' || category === 'hospital_fire' || category === 'mass_casualty');

  if (injuredCount === 0) {
    return (category === 'school_fire' || category === 'hospital_fire' || category === 'apartment_fire' || category === 'roof_fire' || category === 'gas_hazmat') ? 1 : 0;
  }

  if (injuredCount !== null && injuredCount > 0) {
    if (isLargeIncident) {
      // Bei großen Lagen (z. B. Schule) mit moderatem Puffer:
      // Bei 1-2 gemeldeten Personen: 1 Puffer-RTW (+1 Puffer), also 2 RTW für 1 Person, 3-4 RTW für 2 Personen
      if (injuredCount <= 2) {
        return injuredCount + 1; // z.B. 2 vermisste Lehrer -> 3 RTWs (2 für die Personen + 1 Puffer/Eigensicherung Atemschutz)
      } else if (injuredCount <= 5) {
        return injuredCount + 2; // Puffer +2
      } else if (injuredCount <= 20) {
        return Math.ceil(injuredCount * 1.2); // +20% Puffer
      } else {
        return Math.ceil(injuredCount * 1.05); // z.B. 100 Verletzte -> 105 RTWs
      }
    } else {
      // Bei kleineren Einsätzen (z. B. Zimmerbrand, PKW-Unfall) EXAKT so viele RTWs wie Personen gemeldet sind (z.B. genau 2 RTWs bei 2 Personen)
      return injuredCount;
    }
  }

  // Falls Anzahl noch nicht beziffert:
  if (category === 'school_fire') return 3;
  if (category === 'hospital_fire') return 3;
  if (category === 'mass_casualty') return 5;
  if (category === 'trapped_crash') return 2;
  return 1;
}

function buildTacticalFleet(category: string, injuredCount: number | null): any[] {
  const rtwCount = calculateRtwFleetCount(category, injuredCount);

  const rtwUnits: any[] = [];
  for (let i = 1; i <= rtwCount; i++) {
    const stationNum = Math.min(20, Math.ceil(i / 2));
    const stationName = stationNum <= 4
      ? (stationNum === 1 ? 'Rettungswache 1 (Zentrum)' : stationNum === 2 ? 'Rettungswache 2 (Nord)' : stationNum === 3 ? 'Rettungswache 3 (Süd)' : 'Rettungswache 4 (Ost)')
      : `Rettungswache ${stationNum} (Umland / Nachbarlandkreis)`;
    const eta = 3 + (i % 3);
    rtwUnits.push({
      id: `rtw_${i}`,
      code: `Rettung ${stationNum}/83-${((i - 1) % 4) + 1}`,
      name: `Rettungswagen RTW ${i} (${injuredCount && injuredCount > 0 ? `Versorgung Patient ${i}` : 'Notfallrettung & Transport'})`,
      type: 'RTW',
      station: stationName,
      crew: '1/1 (2 Notfallsanitäter)',
      status: 'ANFAHRT',
      statusText: `Status 3 - Sondersignal (${eta} min)`,
      etaMinutes: eta,
      iconType: 'ambulance',
    });
  }

  // Notarzt (NEF)
  const nef1 = {
    id: 'nef_1',
    code: 'Notarzt 1/82-1',
    name: 'Notarzteinsatzfahrzeug NEF 1 (Notfallmediziner)',
    type: 'NEF',
    station: 'Notarztstandort Klinikum Mitte',
    crew: '1/1 (Notarzt & NotSan)',
    status: 'ANFAHRT',
    statusText: 'Status 3 - Sondersignal (3-4 min)',
    etaMinutes: 4,
    iconType: 'ambulance',
  };

  const nef2 = {
    id: 'nef_2',
    code: 'Notarzt 2/82-1',
    name: 'Notarzteinsatzfahrzeug NEF 2 (Notfallmediziner 2)',
    type: 'NEF',
    station: 'Notarztstandort Klinikum Nord',
    crew: '1/1 (Notarzt & NotSan)',
    status: 'ANFAHRT',
    statusText: 'Status 3 - Sondersignal (4 min)',
    etaMinutes: 4,
    iconType: 'ambulance',
  };

  // Base fire units
  const elw1 = {
    id: 'elw_1',
    code: 'Florian 1/11-1',
    name: 'Einsatzleitwagen ELW 1 (Führungsdienst B-Dienst)',
    type: 'ELW 1',
    station: 'Feuerwache 1 (Zentrum)',
    crew: '1/2 (Einsatzleiter B-Dienst)',
    status: 'ANFAHRT',
    statusText: 'Status 3 - Sondersignal (3 min)',
    etaMinutes: 3,
    iconType: 'command',
  };

  const hlf1 = {
    id: 'hlf_1',
    code: 'Florian 1/46-1',
    name: 'Hilfeleistungslöschfahrzeug HLF 20 (1. Angriffstrupp)',
    type: 'HLF 20',
    station: 'Feuerwache 1 (Zentrum)',
    crew: '1/8 (9 Kräfte)',
    status: 'ANFAHRT',
    statusText: 'Status 3 - Sondersignal (3 min)',
    etaMinutes: 3,
    iconType: 'truck',
  };

  const hlf2 = {
    id: 'hlf_2',
    code: 'Florian 1/46-2',
    name: 'Hilfeleistungslöschfahrzeug HLF 20 (2. HLF / Sicherheitstrupp & Wasser)',
    type: 'HLF 20',
    station: 'Feuerwache 1 (Zentrum)',
    crew: '1/8 (9 Kräfte)',
    status: 'ANFAHRT',
    statusText: 'Status 3 - Sondersignal (3-4 min)',
    etaMinutes: 3,
    iconType: 'truck',
  };

  const hlf3 = {
    id: 'hlf_3',
    code: 'Florian 2/46-1',
    name: 'Hilfeleistungslöschfahrzeug HLF 20 (3. HLF / Brandabschnitt 2)',
    type: 'HLF 20',
    station: 'Feuerwache 2 (Nord)',
    crew: '1/8 (9 Kräfte)',
    status: 'ANFAHRT',
    statusText: 'Status 3 - Sondersignal (4 min)',
    etaMinutes: 4,
    iconType: 'truck',
  };

  const dlk1 = {
    id: 'dlk_1',
    code: 'Florian 1/33-1',
    name: 'Drehleiter DLK 23/12 (1. Drehleiter Menschenrettung Hofseite)',
    type: 'DLK 23/12',
    station: 'Feuerwache 1 (Zentrum)',
    crew: '1/2 (3 Kräfte)',
    status: 'ANFAHRT',
    statusText: 'Status 3 - Sondersignal (4 min)',
    etaMinutes: 4,
    iconType: 'ladder',
  };

  const dlk2 = {
    id: 'dlk_2',
    code: 'Florian 2/33-1',
    name: 'Drehleiter DLK 23/12 (2. Drehleiter Straßenseite / Wenderohr)',
    type: 'DLK 23/12',
    station: 'Feuerwache 2 (Nord)',
    crew: '1/2 (3 Kräfte)',
    status: 'ANFAHRT',
    statusText: 'Status 3 - Sondersignal (4 min)',
    etaMinutes: 4,
    iconType: 'ladder',
  };

  const tlf4000 = {
    id: 'tlf_1',
    code: 'Florian 1/24-1',
    name: 'Großtanklöschfahrzeug TLF 4000 (4.000L Löschwasser & Schaum)',
    type: 'TLF 4000',
    station: 'Feuerwache 1 (Zentrum)',
    crew: '1/2 (3 Kräfte)',
    status: 'ANFAHRT',
    statusText: 'Status 3 - Sondersignal (4 min)',
    etaMinutes: 4,
    iconType: 'tank',
  };

  const gwa = {
    id: 'gwa_1',
    code: 'Florian 1/53-1',
    name: 'Gerätewagen Atemschutz GW-A (Atemschutz-Ersatzgeräte)',
    type: 'GW-A',
    station: 'Feuerwache 1 (Zentrum)',
    crew: '1/2 (3 Kräfte)',
    status: 'ANFAHRT',
    statusText: 'Status 3 - Sondersignal (4 min)',
    etaMinutes: 4,
    iconType: 'rescue',
  };

  const rw2 = {
    id: 'rw_1',
    code: 'Florian 1/52-1',
    name: 'Rüstwagen RW 2 (Schwere technische Rettung / Seilwinde 50kN)',
    type: 'RW',
    station: 'Feuerwache 1 (Zentrum)',
    crew: '1/2 (3 Kräfte)',
    status: 'ANFAHRT',
    statusText: 'Status 3 - Sondersignal (4 min)',
    etaMinutes: 4,
    iconType: 'rescue',
  };

  const lf20 = {
    id: 'lf_1',
    code: 'Florian 3/44-1',
    name: 'Löschgruppenfahrzeug LF 20 KatS (Wasserförderung Hydrantennetz)',
    type: 'LF 20',
    station: 'Löschzug 3 (Süd)',
    crew: '1/8 (9 Kräfte)',
    status: 'ANFAHRT',
    statusText: 'Status 3 - Sondersignal (4 min)',
    etaMinutes: 4,
    iconType: 'truck',
  };

  const kdow1 = {
    id: 'kdow_1',
    code: 'Florian 1/10-1',
    name: 'Kommandowagen KdoW (Einsatzführungsdienst)',
    type: 'KdoW',
    station: 'Feuerwache 1 (Zentrum)',
    crew: '1/1 (Führungskraft B-Dienst)',
    status: 'ANFAHRT',
    statusText: 'Status 3 - Sondersignal (3 min)',
    etaMinutes: 3,
    iconType: 'command',
  };

  const gwg1 = {
    id: 'gwg_1',
    code: 'Florian 1/54-1',
    name: 'Gerätewagen Gefahrgut GW-G (Chemieschutzanzüge & Messtechnik)',
    type: 'GW-G',
    station: 'Feuerwache 1 (Zentrum)',
    crew: '1/2 (3 Kräfte)',
    status: 'ANFAHRT',
    statusText: 'Status 3 - Sondersignal (4 min)',
    etaMinutes: 4,
    iconType: 'rescue',
  };

  const gwl1 = {
    id: 'gwl_1',
    code: 'Florian 1/59-1',
    name: 'Gerätewagen Logistik GW-L2 (AB-Pumpen / Wasserschaden)',
    type: 'GW-L',
    station: 'Feuerwache 1 (Zentrum)',
    crew: '1/2 (3 Kräfte)',
    status: 'ANFAHRT',
    statusText: 'Status 3 - Sondersignal (4 min)',
    etaMinutes: 4,
    iconType: 'truck',
  };

  const rtb1 = {
    id: 'rtb_1',
    code: 'Pelikan 1/79-1',
    name: 'Wasserrettungseinheit / Rettungsboot RTB 1',
    type: 'Wasserrettung',
    station: 'Feuerwache 1 (Hafen & Wasserrettungszug)',
    crew: '1/3 (4 Rettungstaucher & Bootsführer)',
    status: 'ANFAHRT',
    statusText: 'Status 3 - Sondersignal (4 min)',
    etaMinutes: 4,
    iconType: 'rescue',
  };

  // AAO Leitfaden Kategorien:
  // 1. Brandmeldeanlage (BMA-001 bis BMA-100: 1x ELW/KdoW + 1x LF/HLF; bei Sonderobjekt ggf. DLK)
  if (category === 'bma_alarm') {
    return [
      kdow1,
      hlf1,
      dlk1,
    ];
  }

  // 2. Brandeinsätze Stufe 3 / Großbrand / Schule / Krankenhaus (3-5x LF/HLF + DLK + TLF + ELW + Sonderfahrzeuge)
  if (category === 'school_fire' || category === 'large_fire' || category === 'hospital_fire') {
    const list = [
      elw1,
      hlf1,
      hlf2,
      hlf3,
      dlk1,
      dlk2,
      tlf4000,
      gwa,
      lf20,
      ...rtwUnits,
      nef1,
    ];
    if (rtwCount >= 4) list.push(nef2);
    return list;
  }

  // 3. Brandeinsätze Stufe 2 mittel (z.B. Mehrfamilienhaus, Kellerwohnung, Dachgeschoss: 2x LF/HLF + DLK + TLF + ELW)
  if (category === 'apartment_fire' || category === 'roof_fire') {
    const list = [
      elw1,
      hlf1,
      dlk1,
      hlf2,
      tlf4000,
      lf20,
      ...rtwUnits,
    ];
    if (injuredCount && injuredCount > 0) list.push(nef1);
    return list;
  }

  // 4. Brandeinsätze Stufe 1 klein (Küche, Zimmer, Kleinbrand, Pkw-Brand: 1x LF/HLF; DLK bei mehrgeschossig, TLF nach Lage)
  if (category === 'small_fire') {
    return [
      hlf1,
      tlf4000,
      ...(rtwUnits.length > 0 ? rtwUnits : []),
    ];
  }

  // 5. Technische Hilfeleistung mit Menschenrettung / Eingeklemmte Person (TH-021: 1x HLF + 1x RW bei technischer Rettung + ELW; ggf. 2. HLF)
  if (category === 'trapped_crash') {
    const list = [
      elw1,
      hlf1,
      rw2,
      hlf2,
      ...rtwUnits,
      nef1,
    ];
    if (rtwCount >= 3) list.push(nef2);
    return list;
  }

  // 6. Verkehrsunfall klein / Blechschaden (TH-001: 1x HLF/LF)
  if (category === 'minor_crash') {
    return [
      hlf1,
      ...rtwUnits,
    ];
  }

  // 7. Menschenrettung über Drehleiter (MR-011: 1x DLK + 1x LF/HLF + ELW)
  if (category === 'human_rescue_ladder') {
    return [
      elw1,
      hlf1,
      dlk1,
      ...rtwUnits,
    ];
  }

  // 8. Türöffnung (TH-031 / MR-081: 1x HLF/LF mit Türöffnungssatz)
  if (category === 'door_opening') {
    return [
      {
        id: 'hlf_door',
        code: 'Florian 1/46-1',
        name: 'HLF 20 (Spezial-Türöffnungssatz Ziehfix / Fräse)',
        type: 'HLF 20',
        station: 'Feuerwache 1 (Zentrum)',
        crew: '1/8 (9 Kräfte)',
        status: 'ANFAHRT',
        statusText: 'Status 3 - Sondersignal (3 min)',
        etaMinutes: 3,
        iconType: 'truck',
      },
      ...rtwUnits,
    ];
  }

  // 9. Unwetter / Wasser im Gebäude / Starkregen (TH-041 / UW-001: 1x LF/HLF + GW-L/AB-Pumpen)
  if (category === 'water_storm') {
    return [
      hlf1,
      gwl1,
      lf20,
    ];
  }

  // 10. Sturmschaden / Baum / Ast (TH-051 / UW-011: 1x HLF/LF; DLK bei Arbeiten in Höhe)
  if (category === 'storm_tree') {
    return [
      hlf1,
      dlk1,
    ];
  }

  // 11. Gefahrgut / ABC / Gasgeruch (ABC-001 / ABC-011: 1x LF/HLF + ELW + GW-G/ABC)
  if (category === 'gas_hazmat') {
    return [
      elw1,
      hlf1,
      gwg1,
      hlf2,
      ...rtwUnits,
    ];
  }

  // 12. Wasserrettung (WR-001 bis WR-040: Wasserrettungseinheit/Boot + 1x LF/HLF; ELW, RTW und Notarzt)
  if (category === 'water_rescue') {
    return [
      elw1,
      rtb1,
      hlf1,
      ...rtwUnits,
      nef1,
    ];
  }

  // 13. Massenanfall / Verkehrs-MANV (VT-091 / GR-011: ELW + Feuerwehrkräfte + LNA + OrgL + RTWs + NEFs)
  if (category === 'mass_casualty') {
    return [
      elw1,
      hlf1,
      hlf2,
      rw2,
      {
        id: 'lna_1',
        code: 'Rettung 1/10-1',
        name: 'Kommandowagen Leitender Notarzt (LNA)',
        type: 'KdoW',
        station: 'Rettungsdienstleitung',
        crew: '1/1 (Leitender Notarzt)',
        status: 'ANFAHRT',
        statusText: 'Status 3 - Sondersignal (3 min)',
        etaMinutes: 3,
        iconType: 'command',
      },
      {
        id: 'orgl_1',
        code: 'Rettung 1/11-1',
        name: 'Einsatzleitwagen OrgL Rettungsdienst',
        type: 'ELW',
        station: 'Rettungsdienstleitung',
        crew: '1/1 (Organisatorischer Leiter)',
        status: 'ANFAHRT',
        statusText: 'Status 3 - Sondersignal (3 min)',
        etaMinutes: 3,
        iconType: 'command',
      },
      ...rtwUnits,
      nef1,
      nef2,
    ];
  }

  // 14. Reanimation
  if (category === 'resuscitation') {
    return [
      {
        id: 'fr_1',
        code: 'Florian 1/46-1',
        name: 'First Responder HLF 20 (Frühdefibrillator AED & Sauerstoff)',
        type: 'HLF 20',
        station: 'Feuerwache 1 (Zentrum)',
        crew: '1/8 (Ersthelfer-Staffel)',
        status: 'ANFAHRT',
        statusText: 'Status 3 - Sondersignal (3 min)',
        etaMinutes: 3,
        iconType: 'truck',
      },
      ...rtwUnits,
      nef1,
    ];
  }

  // 15. Medizinischer Notfall
  if (category === 'medical') {
    return [
      ...rtwUnits,
      nef1,
    ];
  }

  // General fallback: 1x HLF/LF (+ RTWs)
  return [
    hlf1,
    ...rtwUnits,
  ];
}

// Dedicated Geocoding Endpoint
app.get('/api/geocode', async (req, res) => {
  const query = (req.query.q as string) || '';
  const geo = await geocodeLocation(query, 'Kiel');
  if (geo) {
    res.json(geo);
  } else {
    res.status(404).json({ error: 'Location not found' });
  }
});

// Dedicated Road Routing Endpoint (follows actual streets via OSRM)
app.get('/api/route', async (req, res) => {
  const startLat = parseFloat(req.query.startLat as string);
  const startLng = parseFloat(req.query.startLng as string);
  const targetLat = parseFloat(req.query.targetLat as string);
  const targetLng = parseFloat(req.query.targetLng as string);

  if (isNaN(startLat) || isNaN(startLng) || isNaN(targetLat) || isNaN(targetLng)) {
    return res.status(400).json({ error: 'Invalid start or target coordinates' });
  }

  const coordinates = await fetchRoadRoute(startLat, startLng, targetLat, targetLng);
  return res.json({ coordinates });
});

// Dispatcher API Endpoint
app.post('/api/dispatcher/respond', async (req, res) => {
  try {
    const { messages, userLocation } = req.body;

    const gemini = getGeminiClient();

    const conversationTranscript = (messages || [])
      .map((m: { sender: string; text: string }) => `${m.sender === 'user' ? 'Anrufer' : 'Disponent'}: ${m.text}`)
      .join('\n');

    const systemPrompt = `Du bist ein professioneller, extrem ruhiger und hochkompetenter Leitstellendisponent (Integrierte Regionalleitstelle Mitte / Feuerwehr & Rettungsdienst Kiel Notruf 112).

STRIKTE LEITSTELLEN-REGELN:
1. DER EINSATZORT IST IMMER IN KIEL (LEITSTELLE KIEL):
   - Die Stadt Kiel steht IMMER fest! Der Disponent fragt NIEMALS nach der Stadt!
   - Bei der 1. W-Frage (WO) fragst du zunächst nach der genauen Adresse, Straße oder dem Objekt in Kiel: "An welcher Adresse oder Straße in Kiel befindet sich der Notfallort?"
   - WICHTIGE REGEL BEI NENNUNG NUR EINES STRASSENNAMENS (OHNE HAUSNUMMER):
     - Wenn der Anrufer nur den Straßennamen ohne Hausnummer nennt (z. B. "Holstenstraße", "Illerweg", "Feldstraße", "Westring"):
     - Der Disponent muss zwingend nachfragen, wo genau bzw. bei welcher Hausnummer der Notruf ist:
       "Wo genau in der [Straße]? Bei welcher Hausnummer? Falls kein Haus in der Nähe ist: Nennen Sie eine nahe Querstraße oder beschreiben Sie die Umgebung!"
     - Solange weder eine Hausnummer noch eine nahe Querstraße oder Umgebungsbeschreibung genannt wurde, bleibt fiveW.wo.completed = false!
     - Erst wenn eine Hausnummer (z. B. "Hausnummer 10", "bei 12"), eine Querstraße (z. B. "Kreuzung Knooper Weg", "Ecke Bergstraße") oder eine Umgebungsbeschreibung (z. B. "Höhe Bushaltestelle", "am Park", "kein Haus in der Nähe, an der Brücke") genannt wird:
       - setze fiveW.wo.completed = true und übernimm die genaue Ortsangabe in den Einsatzort!
   - SONDERREGEL FÜR SCHNELLSTRASSEN / AUTOBAHNEN / VERKEHRSUNFÄLLE (FAHRTRICHTUNG & ABSCHNITT):
     - Wenn eine Schnellstraße/Autobahn oder ein Straßenabschnitt genannt wird (z. B. "B 76", "Theodor-Heuss-Ring"):
     - Frage nach Fahrtrichtung und Abschnitt/Stadtteil (z. B. "In welche Fahrtrichtung und auf Höhe welchen Stadtteils?").
   - Solange keine konkrete Straße oder Adresse in Kiel genannt wurde:
     - setze stadt = "Kiel"
     - setze einsatzort = "Straße in Kiel wird erfragt"
     - setze fiveW.wo.completed = false

2. SOFORTIGES ABHAKEN BEREITS VOM ANRUFER GENANNTER 5-W INFORMATIONEN (NIEMALS DOPPELT FRAGEN!):
   - Wenn der Anrufer (z. B. in der ersten Nachricht oder im Verlauf) schon Angaben gemacht hat, hake diese W-Punkte SOFORT als completed = true ab und frage NIEMALS später noch einmal danach!
   - Hat der Anrufer gesagt, WAS passiert ist (z. B. "Massenanfall von Verletzten", "Brand", "Schulbrand", "Unfall", "Gasgeruch", "Reanimation"):
     -> fiveW.was.completed = true! Niemals mehr "Was genau ist passiert?" fragen!
   - Hat der Anrufer gesagt, WIE VIELE betroffen/verletzt/vermisst sind (z. B. "Massenanfall von Verletzten", "viele Verletzte", "2 Lehrer vermisst", "keine Verletzten", "5 Personen"):
     -> fiveW.wieViele.completed = true! Niemals mehr nach der Anzahl fragen!
   - Hat der Anrufer Gefahren genannt (z. B. "Rauch", "Feuer", "Flammen", "Gas", "eingeklemmt", "Explosion", "keine Gefahr"):
     -> fiveW.welcheGefahren.completed = true!
   - Wenn der Anrufer in einer einzigen Nachricht direkt mehrere oder alle W-Fragen beantwortet (z. B. "In der Holstenstraße brennt eine Schule, 2 Lehrer werden vermisst, dichter Rauch"):
     -> Dann werden SOFORT WO, WAS, WIE VIELE und WELCHE GEFAHREN auf completed = true gesetzt und sofort die Einheiten alarmiert (warten: completed = true)!
   - Frage IMMER NUR nach den W-Fragen, die WIRKLICH NOCH FEHLEN! Frage NIEMALS nach etwas, was der Anrufer schon erwähnt hat!

3. EINSATZSTICHWORT & ALARMIERUNGSSTUFE (OFFIZIELLER AAO-LEITFADEN FEUERWEHR 1000 EINSATZSTICHWORTE):
   Verwende realistische Kennungen und Stichworte gemäß dem Leitfaden:
   - Brandeinsätze (BR-xxx):
     * BR-001 Wohnungsbrand – Küche (Alarmstufe 1 - klein)
     * BR-006 Wohnungsbrand – Mehrfamilienhaus (Alarmstufe 2 - mittel)
     * BR-009 Wohnungsbrand – Person vermisst (Alarmstufe 3 - groß/Sonderlage)
     * BR-010 Wohnungsbrand – Ausbreitung bestätigt (Alarmstufe 3 - groß/Sonderlage)
     * BR-012 Gebäudebrand – Schule (Alarmstufe 1 - klein bzw. Alarmstufe 3 - groß bei Großbrand)
     * BR-014 Gebäudebrand – Krankenhaus (Alarmstufe 2 - mittel)
     * BR-021 Dachstuhlbrand – Wohngebäude (Alarmstufe 1 - klein bzw. 2 - mittel)
     * BR-031 Kellerbrand – Pkw (Alarmstufe 1 - klein)
     * BR-036 Kellerbrand – Wohngebäude (Alarmstufe 2 - mittel)
     * BR-051 Fahrzeugbrand – Pkw (Alarmstufe 1 - klein)
     * BR-061 Vegetationsbrand – Wohngebiet (Alarmstufe 1 - klein)
     * BR-071 Rauchentwicklung – ohne Verletzte (Alarmstufe 1 - klein)
   - Brandmeldeanlagen (BMA-xxx):
     * BMA-001 Brandmeldeanlage (Alarmstufe 1 - klein)
   - Menschenrettung (MR-xxx):
     * MR-001 Person in Gefahr (Alarmstufe 1 - klein / 2 - mittel)
     * MR-011 Menschenrettung über Drehleiter (Alarmstufe 1 - klein / 2 - mittel)
     * MR-031 Person unter Trümmern (Alarmstufe 2 - mittel)
   - Technische Hilfeleistung (TH-xxx):
     * TH-001 Verkehrsunfall – Pkw (Alarmstufe 1 - klein)
     * TH-021 Eingeklemmte Person – Straße (Alarmstufe 2 - mittel)
     * TH-036 Türöffnung – Wohngebäude (Alarmstufe 1 - klein / 2 - mittel)
     * TH-041 Wasser im Gebäude – Rohrbruch (Alarmstufe 1 - klein)
     * TH-051 Sturmschaden – Baum/Ast (Alarmstufe 1 - klein)
     * TH-071 Ölspur/Betriebsstoffe (Alarmstufe 1 - klein)
   - Gefahrgut / ABC (ABC-xxx):
     * ABC-001 Gefahrstoffaustritt (Alarmstufe 2 - mittel)
     * ABC-011 Gasgeruch – Gebäude (Alarmstufe 2 - mittel)
     * ABC-021 CO-Austritt (Alarmstufe 2 - mittel)
   - Wasserrettung (WR-xxx):
     * WR-001 Person im Wasser (Alarmstufe 1 - klein / 2 - mittel)
     * WR-031 Eisrettung (Alarmstufe 2 - mittel)
   - Unwetter / Naturgefahren (UW-xxx):
     * UW-001 Starkregen – Kellerwohnung (Alarmstufe 2 - mittel)
     * UW-011 Baum/Ast – Straße (Alarmstufe 1 - klein)
   - Verkehrs- und Transportereignisse (VT-xxx):
     * VT-001 Busunfall (Alarmstufe 2 - mittel)
     * VT-021 Lkw/Ladung (Alarmstufe 2 - mittel)
     * VT-091 Verkehrs-MANV (Alarmstufe 3 - groß/Sonderlage)
   - Groß- und Sonderlagen (GR-xxx):
     * GR-001 Großbrand (Alarmstufe 3 - groß/Sonderlage)
     * GR-011 MANV-Unterstützung – Massenanfall (Alarmstufe 3 - groß/Sonderlage)

4. FAHRZEUGAUSRÜCKUNG EXAKT NACH DEM AAO-LEITFADEN:
   - Bei Alarmstufe 1 – klein:
     1× LF/HLF; DLK bei mehrgeschossigem Objekt, TLF nach Lage (+ RTW zur Absicherung)
   - Bei Alarmstufe 2 – mittel:
     2× LF/HLF + DLK + TLF + ELW; ggf. GW-A/GW-L
     bzw. bei Technischer Hilfeleistung mit Eingeklemmten: 1× HLF + 1× RW bei technischer Rettung + ELW; ggf. 2. HLF
   - Bei Alarmstufe 3 – groß/Sonderlage / Schule / MANV:
     ELW/Führungsunterstützung + 3–5× LF/HLF + DLK + TLF; Sonderfahrzeuge nach Lage (GW-A, GW-L, RW, KatS)
   - Bei BMA: 1× ELW/KdoW + 1× LF/HLF; bei Sonderobjekt ggf. DLK
   - Bei ABC/Gefahrgut: 1× LF/HLF + ELW + GW-G/ABC (+ Messtechnik)
   - Bei Wasserrettung: Wasserrettungseinheit/Boot + 1× LF/HLF; ELW, RTW und Notarzt
   - Bei MANV / Massenanfall: ELW + Feuerwehrkräfte; Rettungsdienst / OrgL / LNA separat + RTWs passend zur Verletztenzahl + NEFs

5. RETTUNGSDIENST-REGEL (RTW-DISPOSITION):
   - WICHTIG - HAUSNUMMERN SIND KEINE VERLETZTEN: Eine Zahl in einer Adresse (z. B. "Illerweg 10", "Holstenstraße 5", "Westring 20") ist die Hausnummer des Einsatzorts und NIEMALS die Anzahl verletzter Personen!
   - Bei kleineren Einsätzen: Wo z.B. 2 Personen vermisst oder verletzt werden, werden auch NUR GENAU 2 RTWs entsandt!
   - Bei großen Einsätzen (z. B. Schulbrand, MANV): Es wird mit taktischem Puffer alarmiert (z. B. bei 2 vermissten Lehrern: 3 RTWs = 2 für die Personen + 1 Puffer; bei 10 Verletzten ca. 12 RTWs).
   - Bei Brandeinsätzen ohne gemeldete Verletzte: 1 RTW zur Eigensicherung der Atemschutztrupps mitschicken.

6. STRIKTE DISPATCH-SPERRE & NACHALARMIERUNG BEI ANFRAGE:
   - Die Einheiten dürfen ERST DANN entsandt werden, NACHDEM ALLE 5-W FRAGEN (Wo, Was, Wie viele, Welche Gefahren) VOLLSTÄNDIG abgefragt und beantwortet wurden! Solange eine W-Frage noch offen ist: alarmierteEinheiten = [] und alarmVollautomatischAusgeloest = false! Sobald alle 4 W-Fragen beantwortet sind, sofort alarmierteEinheiten befüllen und alarmVollautomatischAusgeloest = true!
   - NACHALARMIERUNG BEI ANFRAGE DES ANRUFENDEN: Wenn der Anrufer nach weiteren Fahrzeugen fragt oder fordert (z. B. "schicken Sie noch eine Drehleiter", "wir brauchen noch einen Rettungswagen/RTW", "bitte noch ein HLF/Feuerwehrwagen nachalarmieren", "alarmiert noch einen Notarzt/Polizei"), dann NACHALARMIERE diese angeforderten Einheiten SOFORT und füge sie zur Liste alarmierteEinheiten hinzu! Bestätige die Nachalarmierung in deiner Antwort (z. B. "Weitere Drehleiter und Rettungswagen sind nachalarmiert.").

7. KEINE SICHERHEITSHINWEISE für den Anrufer (anruferHinweise bleibt immer ein leeres Array []).
8. ANFAHRTSZEIT: Die Anfahrtszeit (etaMinutes) der Einsatzkräfte beträgt 1 Minute.
9. EXTREM KURZE ANTWORTEN: Halte deine Antworten sehr kurz (maximal 1 kurzer Bestätigungssatz, max 10-15 Wörter) PLUS genau EINE NOCH OFFENE 5-W-Frage am Ende!
10. REIHENFOLGE DER NOCH OFFENEN 5-W FRAGEN:
   - 1. WO (falls Straße in Kiel noch gar nicht genannt): "An welcher Adresse oder Straße in Kiel befindet sich der Notfallort?"
   - 1b. HAUSNUMMER ODER UMGEBUNG (falls nur ein Straßenname ohne Hausnummer und ohne Umgebungsbeschreibung genannt wurde): "Wo genau in der Straße? Bei welcher Hausnummer? Falls kein Haus in der Nähe ist: Nennen Sie eine nahe Querstraße oder beschreiben Sie die Umgebung!"
   - 2. WAS (falls Notfallart noch unklar): "Was genau ist passiert?"
   - 3. WIE VIELE (falls Personen-/Verletztenzahl noch unklar): "Wie viele Personen sind verletzt oder in Gefahr?"
   - 4. WELCHE GEFAHREN (falls Sondergefahren noch unklar): "Welche besonderen Gefahren bestehen vor Ort (z. B. Rauch, Gas, Flammen)?"
   - 5. WARTEN (wenn alle 4 vorherigen beantwortet sind): "Alle 5-W Fragen erfasst. Bleiben Sie am Telefon, Einheiten sind alarmiert."

Antworte ausschließlich im validen JSON-Format gemäß des Schemas.`;

    if (gemini) {
      // List of valid models prioritizing fastest and most capable Gemini 4 & 3.1 endpoints
      const candidateModels = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
      
      for (const modelName of candidateModels) {
        try {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout 5.5s on ${modelName}`)), 5500)
          );
          const response: any = await Promise.race([
            gemini.models.generateContent({
              model: modelName,
              contents: `Gesprächsverlauf bisher:\n${conversationTranscript}\n\nHinweis: Der Einsatzort ist zu Beginn unbekannt und muss vom Anrufer erfragt werden. Antworte extrem kurz mit genau einer 5-W-Frage am Ende.`,
              config: {
                systemInstruction: systemPrompt,
                ...(modelName === 'gemini-4-hydrogen'
                  ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                  : {}),
                responseMimeType: 'application/json',
                responseSchema: {
                type: Type.OBJECT,
                properties: {
                  dispatcherAntwort: {
                    type: Type.STRING,
                    description: 'Extrem kurze Antwort des Disponenten (1 kurzer Satz + 1 gezielte 5-W-Frage am Ende).',
                  },
                  stichwort: {
                    type: Type.STRING,
                    description: 'Feuerwehr/Rettungsdienst Einsatzstichwort, z.B. "B 3 - Zimmerbrand", "THL 2 - VU mit Person", "NOTF - Reanimation", "B 1 - Kleinbrand", "UNWETTER - Keller".',
                  },
                  alarmstufe: {
                    type: Type.INTEGER,
                    description: 'Alarmstufe von 1 bis 4 (1 = Kleinalarm, 2 = Zugalarm, 3 = Verbandsalarm, 4 = Großschadenslage).',
                  },
                  dringlichkeit: {
                    type: Type.STRING,
                    enum: ['NIEDRIG', 'MITTEL', 'HOCH', 'KRITISCH'],
                    description: 'Dringlichkeitsstufe des Notrufs.',
                  },
                  einsatzort: {
                    type: Type.STRING,
                    description: 'Erfasster Einsatzort (Straße, Hausnummer, Ort) erst wenn vom Anrufer genannt, sonst "Wird erfragt".',
                  },
                  lagebericht: {
                    type: Type.STRING,
                    description: 'Kurze Zusammenfassung der aktuellen Lage für den Einsatzleiter.',
                  },
                  anruferHinweise: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'Sicherheits- und Verhaltensregeln für den Anrufer.',
                  },
                  alarmVollautomatischAusgeloest: {
                    type: Type.BOOLEAN,
                    description: 'Wurden Einheiten bereits alarmiert / ausgerückt.',
                  },
                  naechsteFrage: {
                    type: Type.STRING,
                    description: 'Die nächste gezielte Frage nach dem 5-W Schema.',
                  },
                  fiveW: {
                    type: Type.OBJECT,
                    properties: {
                      wo: {
                        type: Type.OBJECT,
                        properties: {
                          completed: { type: Type.BOOLEAN },
                          text: { type: Type.STRING },
                          label: { type: Type.STRING },
                        },
                        required: ['completed', 'text', 'label'],
                      },
                      was: {
                        type: Type.OBJECT,
                        properties: {
                          completed: { type: Type.BOOLEAN },
                          text: { type: Type.STRING },
                          label: { type: Type.STRING },
                        },
                        required: ['completed', 'text', 'label'],
                      },
                      wieViele: {
                        type: Type.OBJECT,
                        properties: {
                          completed: { type: Type.BOOLEAN },
                          text: { type: Type.STRING },
                          label: { type: Type.STRING },
                        },
                        required: ['completed', 'text', 'label'],
                      },
                      welcheGefahren: {
                        type: Type.OBJECT,
                        properties: {
                          completed: { type: Type.BOOLEAN },
                          text: { type: Type.STRING },
                          label: { type: Type.STRING },
                        },
                        required: ['completed', 'text', 'label'],
                      },
                      warten: {
                        type: Type.OBJECT,
                        properties: {
                          completed: { type: Type.BOOLEAN },
                          text: { type: Type.STRING },
                          label: { type: Type.STRING },
                        },
                        required: ['completed', 'text', 'label'],
                      },
                    },
                    required: ['wo', 'was', 'wieViele', 'welcheGefahren', 'warten'],
                  },
                  alarmierteEinheiten: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING },
                        code: { type: Type.STRING, description: 'Funkrufname, z.B. Florian 1/46-1' },
                        name: { type: Type.STRING, description: 'Fahrzeugtyp, z.B. Hilfeleistungslöschgruppenfahrzeug HLF 20' },
                        type: { type: Type.STRING, description: 'HLF 20, DLK 23/12, TLF 4000, RW, ELW 1, RTW, NEF' },
                        station: { type: Type.STRING, description: 'Feuerwache / Löschzug' },
                        crew: { type: Type.STRING, description: 'Besatzungsstärke, z.B. 1/8 (9 Kräfte)' },
                        status: { type: Type.STRING, enum: ['ALARM', 'AUSGERUECKT', 'ANFAHRT', 'EINSATZORT'] },
                        statusText: { type: Type.STRING, description: 'Status 3 - Auf Anfahrt' },
                        etaMinutes: { type: Type.INTEGER, description: 'Anfahrtszeit in Minuten (realistisch etwa 3,5 bis 4 Minuten, d.h. 3 oder 4)' },
                        iconType: { type: Type.STRING, enum: ['truck', 'ladder', 'tank', 'ambulance', 'command', 'rescue'] },
                      },
                      required: ['id', 'code', 'name', 'type', 'station', 'crew', 'status', 'statusText', 'etaMinutes', 'iconType'],
                    },
                  },
                },
                required: [
                  'dispatcherAntwort',
                  'stichwort',
                  'alarmstufe',
                  'dringlichkeit',
                  'einsatzort',
                  'lagebericht',
                  'anruferHinweise',
                  'alarmVollautomatischAusgeloest',
                  'naechsteFrage',
                  'fiveW',
                  'alarmierteEinheiten',
                ],
              },
            },
          }),
          timeoutPromise,
        ]);

          if (response.text) {
            const parsed = JSON.parse(response.text);

            // Prioritize detailed street address over just city for pinpoint geocoding
            const locText = (parsed.einsatzort && !parsed.einsatzort.includes('erfragt'))
              ? parsed.einsatzort
              : (parsed.stadt || '');

            const geo = await geocodeLocation(locText, parsed.stadt);

            if (geo) {
              parsed.locationGeo = geo;
              parsed.stadt = geo.city;
              parsed.einsatzort = geo.displayName;
              if (parsed.fiveW && parsed.fiveW.wo) {
                parsed.fiveW.wo.completed = true;
                parsed.fiveW.wo.text = geo.displayName;
              }

              // Extract all user message text for deterministic 5-W fact validation
              const allUserMsgText = (messages || [])
                .filter((m: { sender: string }) => m.sender === 'user')
                .map((m: { text: string }) => m.text.toLowerCase())
                .join(' ');
              const injured = extractInjuredCount(allUserMsgText);
              const isSchoolMsg = allUserMsgText.includes('schule') || allUserMsgText.includes('schulbrand') || allUserMsgText.includes('gymnasium') || allUserMsgText.includes('grundschule');
              const isManvMsg = allUserMsgText.includes('massenanfall') || allUserMsgText.includes('manv') || allUserMsgText.includes('viele verletzte') || (injured !== null && injured >= 5);

              // Programmatic validation to ensure user-stated facts are NEVER overlooked:
              if (!parsed.fiveW) {
                parsed.fiveW = {
                  wo: { completed: true, text: geo.displayName, label: '1. Wo in Kiel?' },
                  was: { completed: false, text: 'Wird erfragt', label: '2. Was ist passiert?' },
                  wieViele: { completed: false, text: 'Wird erfragt', label: '3. Wie viele Verletzte?' },
                  welcheGefahren: { completed: false, text: 'Wird erfragt', label: '4. Welche Gefahren?' },
                  warten: { completed: false, text: 'Warten auf vollständige 5-W Erfassung', label: '5. Warten auf Rückfragen' },
                };
              }

              // Fact 2 (WAS): Did user tell what happened? (Massenanfall, Brand, Unfall, Feuer, Rauch, etc.)
              const hasStatedWhat = (
                isManvMsg ||
                isSchoolMsg ||
                allUserMsgText.includes('brand') ||
                allUserMsgText.includes('feuer') ||
                allUserMsgText.includes('unfall') ||
                allUserMsgText.includes('rauch') ||
                allUserMsgText.includes('reanimation') ||
                allUserMsgText.includes('gas') ||
                allUserMsgText.includes('wasser') ||
                allUserMsgText.includes('tür') ||
                allUserMsgText.includes('verletzt') ||
                allUserMsgText.includes('bewusstlos')
              );
              if (hasStatedWhat) {
                parsed.fiveW.was.completed = true;
                if (!parsed.fiveW.was.text || parsed.fiveW.was.text.includes('erfragt')) {
                  parsed.fiveW.was.text = isManvMsg
                    ? 'Massenanfall von Verletzten'
                    : isSchoolMsg
                    ? 'Großbrand Schule'
                    : parsed.stichwort || 'Lage gemeldet';
                }
              }

              // Fact 3 (WIE VIELE): Did user state person count / injuries / vermisste?
              const hasStatedInjuredOrCount = (
                injured !== null ||
                isManvMsg ||
                allUserMsgText.includes('keine') ||
                allUserMsgText.includes('niemand') ||
                allUserMsgText.includes('alle') ||
                allUserMsgText.includes('draußen') ||
                allUserMsgText.includes('allein') ||
                allUserMsgText.includes('nur ich') ||
                allUserMsgText.includes('lehrer') ||
                allUserMsgText.includes('vermisst')
              );
              if (hasStatedInjuredOrCount) {
                parsed.fiveW.wieViele.completed = true;
                if (!parsed.fiveW.wieViele.text || parsed.fiveW.wieViele.text.includes('erfragt')) {
                  parsed.fiveW.wieViele.text = injured !== null
                    ? (injured === 0 ? 'Keine Verletzten gemeldet' : `${injured} Person(en) betroffen`)
                    : isManvMsg
                    ? 'Massenanfall (viele Verletzte)'
                    : 'Personenlage erfasst';
                }
              }

              // Fact 4 (WELCHE GEFAHREN): Did user mention hazards or clear safe state?
              const hasStatedHazards = (
                allUserMsgText.includes('rauch') ||
                allUserMsgText.includes('flamme') ||
                allUserMsgText.includes('feuer') ||
                allUserMsgText.includes('gas') ||
                allUserMsgText.includes('gefahr') ||
                allUserMsgText.includes('qualm') ||
                allUserMsgText.includes('sicher') ||
                allUserMsgText.includes('trümmer') ||
                allUserMsgText.includes('ausgelaufen') ||
                allUserMsgText.includes('keine gefahr') ||
                (messages && messages.filter((m: any) => m.sender === 'user').length >= 3)
              );
              if (hasStatedHazards) {
                parsed.fiveW.welcheGefahren.completed = true;
                if (!parsed.fiveW.welcheGefahren.text || parsed.fiveW.welcheGefahren.text.includes('erfragt')) {
                  parsed.fiveW.welcheGefahren.text = 'Gefahrenlage erfasst';
                }
              }

              // Extract clean street base name for targeted questions
              const streetBaseName = geo.displayName ? geo.displayName.split(',')[0].replace(/\b\d{5}\b/g, '').trim() : 'Straße';

              // Check if user text provided a house number (exclude postal code and casualty count)
              const textNoPlz = allUserMsgText.replace(/\b\d{5}\b/g, '');
              const injuredNumStr = injured !== null ? String(injured) : '___';
              const textNoPlzNoInjured = textNoPlz.replace(new RegExp(`\\b${injuredNumStr}\\b`, 'g'), '');
              const hasHouseNum = (
                /\b(?:hausnummer|hnr\.?|nr\.?)\s*\d+[a-z]?\b/i.test(textNoPlz) ||
                /(?:straße|strasse|str\b|str\.|weg\b|gasse\b|platz\b|allee\b|damm\b|ring\b|ufer\b|chaussee\b|markt\b|pfad\b)\s+\d+[a-z]?\b/i.test(textNoPlz) ||
                /\b\d{1,4}[a-z]?\b/.test(textNoPlzNoInjured)
              );

              // Check if user described surroundings, landmarks, or cross-streets
              const hasSurroundingsOrCrossStreet = (
                allUserMsgText.includes('querstraße') ||
                allUserMsgText.includes('kreuzung') ||
                allUserMsgText.includes('ecke') ||
                allUserMsgText.includes('neben') ||
                allUserMsgText.includes('gegenüber') ||
                allUserMsgText.includes('ampel') ||
                allUserMsgText.includes('brücke') ||
                allUserMsgText.includes('park') ||
                allUserMsgText.includes('haltestelle') ||
                allUserMsgText.includes('bahnhof') ||
                allUserMsgText.includes('umgebung') ||
                allUserMsgText.includes('in der nähe') ||
                allUserMsgText.includes('kein haus') ||
                allUserMsgText.includes('kein gebäude') ||
                allUserMsgText.includes('keine hausnummer') ||
                allUserMsgText.includes('höhe') ||
                allUserMsgText.includes('richtung') ||
                allUserMsgText.includes('hassee') ||
                allUserMsgText.includes('gaarden') ||
                allUserMsgText.includes('wik') ||
                allUserMsgText.includes('mettenhof') ||
                allUserMsgText.includes('ellerbek') ||
                allUserMsgText.includes('ravensberg') ||
                allUserMsgText.includes('suchsdorf') ||
                allUserMsgText.includes('russee') ||
                allUserMsgText.includes('elmschenhagen')
              );

              // If only a street was named without house number and without surroundings/cross-streets:
              const needsHouseNumOrSurroundings = !hasHouseNum && !hasSurroundingsOrCrossStreet;

              if (needsHouseNumOrSurroundings && parsed.fiveW && parsed.fiveW.wo) {
                // Keep wo pending house number or surroundings / cross-streets
                parsed.fiveW.wo.completed = false;
                parsed.fiveW.wo.text = `${streetBaseName} (Hausnummer oder Umgebung wird erfragt)`;
              }

              // Check if ALL 5-W questions (Wo, Was, Wie viele, Welche Gefahren) are completed
              const allWCompleted = Boolean(
                parsed.fiveW?.wo?.completed &&
                !needsHouseNumOrSurroundings &&
                parsed.fiveW?.was?.completed &&
                parsed.fiveW?.wieViele?.completed &&
                parsed.fiveW?.welcheGefahren?.completed
              );
              
              if (isSchoolMsg) {
                parsed.stichwort = 'B 4 - Großbrand Schule / Versammlungsstätte';
                parsed.alarmstufe = 4;
              } else if (isManvMsg) {
                parsed.stichwort = 'MANV 1 - Massenanfall von Verletzten';
                parsed.alarmstufe = 3;
              }

              // Fix dispatcher question: Never ask for already answered questions!
              if (allWCompleted) {
                parsed.naechsteFrage = 'Bleiben Sie am Telefon und bringen Sie sich in Sicherheit.';
                if (parsed.dispatcherAntwort.toLowerCase().includes('was genau ist passiert') ||
                    parsed.dispatcherAntwort.toLowerCase().includes('wie viele personen') ||
                    parsed.dispatcherAntwort.toLowerCase().includes('in welche fahrtrichtung') ||
                    parsed.dispatcherAntwort.toLowerCase().includes('bei welcher hausnummer') ||
                    parsed.dispatcherAntwort.toLowerCase().includes('welche besonderen gefahren')) {
                  parsed.dispatcherAntwort = 'Alle 5-W Notruf-Angaben erfasst. Die Einsatzkräfte sind alarmiert und mit Sondersignal auf Anfahrt. Bleiben Sie am Telefon!';
                }
              } else if (!parsed.fiveW.wo.completed) {
                if (needsHouseNumOrSurroundings) {
                  parsed.naechsteFrage = `Wo genau in der ${streetBaseName}? Bei welcher Hausnummer? Falls kein Haus in der Nähe ist: Nennen Sie eine nahe Querstraße oder beschreiben Sie die Umgebung!`;
                } else {
                  parsed.naechsteFrage = 'An welcher Adresse oder Straße in Kiel befindet sich der Notfallort?';
                }
              } else if (!parsed.fiveW.was.completed) {
                parsed.naechsteFrage = 'Was genau ist passiert?';
              } else if (!parsed.fiveW.wieViele.completed) {
                parsed.naechsteFrage = 'Wie viele Personen sind verletzt oder in Gefahr?';
              } else if (!parsed.fiveW.welcheGefahren.completed) {
                parsed.naechsteFrage = 'Welche besonderen Gefahren bestehen vor Ort (z. B. Rauch, Gas, Flammen)?';
              }

              // If Gemini accidentally asked a question that was already answered, or if only a street was named:
              if (!allWCompleted && parsed.dispatcherAntwort) {
                const lowerAns = parsed.dispatcherAntwort.toLowerCase();
                const askingWhat = lowerAns.includes('was genau ist passiert') || lowerAns.includes('was ist passiert');
                const askingHowMany = lowerAns.includes('wie viele personen') || lowerAns.includes('wie viele verletzte');
                const askingHazards = lowerAns.includes('welche besonderen gefahren') || lowerAns.includes('welche gefahren');
                const askingHouseNum = lowerAns.includes('hausnummer') || lowerAns.includes('querstraße') || lowerAns.includes('umgebung');

                if (needsHouseNumOrSurroundings && !askingHouseNum) {
                  parsed.dispatcherAntwort = `${streetBaseName} in Kiel notiert. Wo genau in der ${streetBaseName}? Bei welcher Hausnummer? Falls kein Haus in der Nähe ist: Nennen Sie eine nahe Querstraße oder beschreiben Sie die Umgebung!`;
                } else if ((askingWhat && parsed.fiveW.was.completed) ||
                    (askingHowMany && parsed.fiveW.wieViele.completed) ||
                    (askingHazards && parsed.fiveW.welcheGefahren.completed)) {
                  parsed.dispatcherAntwort = `Verstanden. ${parsed.naechsteFrage}`;
                }
              }

              if (allWCompleted) {
                parsed.alarmVollautomatischAusgeloest = true;
                if (parsed.fiveW && parsed.fiveW.warten) {
                  parsed.fiveW.warten.completed = true;
                  parsed.fiveW.warten.text = 'Alle 5-W Fragen erfasst – Einheiten alarmiert';
                }

                const targetCategory = isSchoolMsg ? 'school_fire' : 'apartment_fire';
                const calculatedRtwCount = calculateRtwFleetCount(targetCategory, injured);

                if (!Array.isArray(parsed.alarmierteEinheiten) || parsed.alarmierteEinheiten.length < 3 || isSchoolMsg) {
                  parsed.alarmierteEinheiten = buildTacticalFleet(targetCategory, injured);
                } else if (calculatedRtwCount > 0) {
                  // Synchronize RTWs in parsed.alarmierteEinheiten so it precisely matches the calculated requirement with buffer
                  const nonRtwUnits = (parsed.alarmierteEinheiten || []).filter((u: any) => u.type !== 'RTW');
                  const rtwUnits: any[] = [];
                  for (let i = 1; i <= calculatedRtwCount; i++) {
                    const stationNum = Math.min(20, Math.ceil(i / 2));
                    const stationName = stationNum <= 4
                      ? (stationNum === 1 ? 'Rettungswache 1 (Zentrum)' : stationNum === 2 ? 'Rettungswache 2 (Nord)' : stationNum === 3 ? 'Rettungswache 3 (Süd)' : 'Rettungswache 4 (Ost)')
                      : `Rettungswache ${stationNum} (Umland / Nachbarlandkreis)`;
                    const eta = 3 + (i % 3);
                    const isBuffer = injured !== null && i > injured;
                    rtwUnits.push({
                      id: `u_rtw_dyn_${i}`,
                      code: `Rettung ${stationNum}/83-${((i - 1) % 4) + 1}`,
                      name: `Rettungswagen RTW ${i} (${isBuffer ? 'Puffer / Atemschutz-Eigensicherung' : `Versorgung Patient/Vermisster ${i}`})`,
                      type: 'RTW',
                      station: stationName,
                      crew: '1/1 (2 Notfallsanitäter)',
                      status: 'ANFAHRT',
                      statusText: `Status 3 - Sondersignal (${eta} min)`,
                      etaMinutes: eta,
                      iconType: 'ambulance',
                    });
                  }
                  parsed.alarmierteEinheiten = [...nonRtwUnits, ...rtwUnits];
                }

                // Nachalarmierung check: Did user request extra units in the call (e.g. DLK, RTW, HLF, NEF)?
                const lowerLastUser = ((messages || []).filter((m: any) => m.sender === 'user').slice(-1)[0]?.text || '').toLowerCase();
                const wantsExtraDlk = lowerLastUser.includes('drehleiter') || lowerLastUser.includes('dlk');
                const wantsExtraRtw = lowerLastUser.includes('rettungswagen') || lowerLastUser.includes('rtw') || lowerLastUser.includes('krankenwagen');
                const wantsExtraHlf = lowerLastUser.includes('hlf') || lowerLastUser.includes('löschfahrzeug') || lowerLastUser.includes('feuerwehrwagen');
                const wantsExtraNef = lowerLastUser.includes('notarzt') || lowerLastUser.includes('nef');
                const isNachalarmierung = lowerLastUser.includes('nachalarm') || lowerLastUser.includes('mehr') || lowerLastUser.includes('weiter') || lowerLastUser.includes('schick') || lowerLastUser.includes('brauch');

                if (isNachalarmierung || wantsExtraDlk || wantsExtraRtw || wantsExtraHlf || wantsExtraNef) {
                  const currentUnits = Array.isArray(parsed.alarmierteEinheiten) ? [...parsed.alarmierteEinheiten] : [];
                  if (wantsExtraDlk && !currentUnits.some((u: any) => u.id === 'extra_dlk')) {
                    currentUnits.push({
                      id: 'extra_dlk',
                      code: 'Florian 2/33-2',
                      name: 'Drehleiter DLK 23/12 (Nachalarmiert)',
                      type: 'DLK 23/12',
                      station: 'Feuerwache 2 (Nord)',
                      crew: '1/2 (3 Kräfte)',
                      status: 'ANFAHRT',
                      statusText: 'Status 3 - Nachalarmiert',
                      etaMinutes: 1,
                      iconType: 'ladder',
                    });
                  }
                  if (wantsExtraRtw && !currentUnits.some((u: any) => u.id === 'extra_rtw')) {
                    currentUnits.push({
                      id: 'extra_rtw',
                      code: 'Rettung 1/83-9',
                      name: 'Rettungswagen RTW (Nachalarmiert)',
                      type: 'RTW',
                      station: 'Rettungswache 1',
                      crew: '1/1 (2 Notfallsanitäter)',
                      status: 'ANFAHRT',
                      statusText: 'Status 3 - Nachalarmiert',
                      etaMinutes: 1,
                      iconType: 'ambulance',
                    });
                  }
                  if (wantsExtraHlf && !currentUnits.some((u: any) => u.id === 'extra_hlf')) {
                    currentUnits.push({
                      id: 'extra_hlf',
                      code: 'Florian 1/46-9',
                      name: 'Hilfeleistungslöschfahrzeug HLF 20 (Nachalarmiert)',
                      type: 'HLF 20',
                      station: 'Feuerwache 1',
                      crew: '1/8 (9 Kräfte)',
                      status: 'ANFAHRT',
                      statusText: 'Status 3 - Nachalarmiert',
                      etaMinutes: 1,
                      iconType: 'truck',
                    });
                  }
                  if (wantsExtraNef && !currentUnits.some((u: any) => u.id === 'extra_nef')) {
                    currentUnits.push({
                      id: 'extra_nef',
                      code: 'Notarzt 1/82-2',
                      name: 'Notarzteinsatzfahrzeug NEF (Nachalarmiert)',
                      type: 'NEF',
                      station: 'Klinikum Mitte',
                      crew: '1/1 (Notarzt & NotSan)',
                      status: 'ANFAHRT',
                      statusText: 'Status 3 - Nachalarmiert',
                      etaMinutes: 1,
                      iconType: 'ambulance',
                    });
                  }
                  parsed.alarmierteEinheiten = currentUnits;
                }

                if (Array.isArray(parsed.alarmierteEinheiten) && parsed.alarmierteEinheiten.length > 0) {
                  // Set ETA everywhere to 1 minute
                  parsed.alarmierteEinheiten = parsed.alarmierteEinheiten.map((u: any) => ({
                    ...u,
                    etaMinutes: 1,
                    statusText: u.status === 'EINSATZORT' ? 'Status 4 - Vor Ort' : 'Status 3 - Auf Anfahrt (1 min)',
                  }));
                  parsed.alarmierteEinheiten = await assignVehicleCoordinates(parsed.alarmierteEinheiten, geo);
                }
              } else {
                // Strict 5-W Gate: HOLD dispatch until ALL 5-W questions are answered!
                parsed.alarmVollautomatischAusgeloest = false;
                parsed.alarmierteEinheiten = [];
                if (parsed.fiveW && parsed.fiveW.warten) {
                  parsed.fiveW.warten.completed = false;
                  parsed.fiveW.warten.text = 'Warten auf vollständige 5-W Erfassung';
                }
              }
            } else {
              // Location not yet named - HOLD dispatch until user names city or address!
              parsed.locationGeo = null;
              parsed.stadt = '';
              parsed.alarmVollautomatischAusgeloest = false;
              parsed.alarmierteEinheiten = [];
              if (parsed.fiveW && parsed.fiveW.wo) {
                parsed.fiveW.wo.completed = false;
                parsed.fiveW.wo.text = 'Stadt wird erfragt';
              }
              if (parsed.fiveW && parsed.fiveW.warten) {
                parsed.fiveW.warten.completed = false;
              }
              parsed.einsatzort = 'Stadt wird erfragt';
              parsed.naechsteFrage = 'In welcher Stadt und an welcher Adresse befindet sich der Notfallort?';
            }

            // Remove safety hints per user request
            parsed.anruferHinweise = [];

            return res.json(parsed);
          }
        } catch (modelError: any) {
          console.warn(`Model ${modelName} call issue: ${modelError?.message || modelError}. Trying next candidate...`);
        }
      }
    }

    const fallbackResult = await evaluateEmergencyRuleEngine(messages || []);
    return res.json(fallbackResult);
  } catch (err: any) {
    console.error('Dispatcher error:', err);
    res.status(500).json({ error: 'Dispatcher error', message: err.message });
  }
});

// Reusable fast stateful rule engine for Kiel 5-W tracking, geocoding, and AAO dispatch
async function evaluateEmergencyRuleEngine(messages: Array<{ sender: string; text: string }>) {
    const userMessages = (messages || []).filter((m) => m.sender === 'user');
    const userTurnCount = userMessages.length;
    const allUserTexts = userMessages.map((m) => m.text.toLowerCase()).join(' ');
    const lastUserMsg = userMessages[userMessages.length - 1]?.text || '';
    const lastUserLower = lastUserMsg.toLowerCase();
    
    // 1. Emergency city is ALWAYS Kiel
    const detectedCityMatch = 'Kiel';

    // 2. Detect street or specific address phrase across user messages
    let addressCandidate = '';
    const streetRegex = /([A-Za-zÄÖÜäöüß.\- ]+?(?:straße|strasse|str\b|str\.|weg\b|gasse\b|platz\b|allee\b|damm\b|ring\b|ufer\b|chaussee\b|markt\b|pfad\b)(?:\s+\d+[a-zA-Z]?)?)/i;
    for (const msg of userMessages) {
      const match = msg.text.match(streetRegex);
      if (match) {
        // Clean leading words like "in der", "an der", etc.
        addressCandidate = match[1].replace(/^(hier\s+)?(in\s+der\s+|an\s+der\s+|auf\s+der\s+|bei\s+der\s+|am\s+|im\s+|in\s+)/i, '').trim();
        break;
      }
    }

    // Also check for well-known Kiel landmarks and streets
    if (!addressCandidate) {
      for (const [key, val] of Object.entries(KIEL_KNOWN_LOCATIONS)) {
        if (allUserTexts.includes(key)) {
          addressCandidate = val.displayName;
          break;
        }
      }
    }

    let extractedLocation = 'Straße in Kiel wird erfragt';
    let woCompleted = false;
    let locationGeo: GeoResult | null = null;

    if (addressCandidate) {
      const fullAddressQuery = `${addressCandidate}, Kiel`;
      locationGeo = await geocodeLocation(fullAddressQuery, 'Kiel');
      if (locationGeo) {
        woCompleted = true;
        extractedLocation = locationGeo.displayName;
      }
    }

    // Default map centering on Kiel if street is not yet pinpointed
    if (!locationGeo) {
      locationGeo = {
        lat: 54.3233,
        lng: 10.1228,
        city: 'Kiel',
        displayName: 'Kiel, Schleswig-Holstein',
        country: 'Deutschland',
      };
    }

    // Extract injured person count
    const detectedInjuredCount = extractInjuredCount(allUserTexts);

    // Detailed Incident Categorization strictly matching caller's report
    const isSchool = (
      allUserTexts.includes('schule') ||
      allUserTexts.includes('schulbrand') ||
      allUserTexts.includes('gymnasium') ||
      allUserTexts.includes('grundschule') ||
      allUserTexts.includes('realschule') ||
      allUserTexts.includes('gesamtschule') ||
      allUserTexts.includes('berufsschule') ||
      allUserTexts.includes('universität') ||
      allUserTexts.includes('uni') ||
      allUserTexts.includes('kindergarten') ||
      allUserTexts.includes('kita') ||
      allUserTexts.includes('schüler') ||
      allUserTexts.includes('klassenzimmer')
    );

    const isHospital = (
      allUserTexts.includes('krankenhaus') ||
      allUserTexts.includes('klinik') ||
      allUserTexts.includes('altenheim') ||
      allUserTexts.includes('pflegeheim') ||
      allUserTexts.includes('seniorenheim')
    );

    const isCommercial = (
      allUserTexts.includes('industrie') ||
      allUserTexts.includes('lagerhalle') ||
      allUserTexts.includes('fabrik') ||
      allUserTexts.includes('gewerbe') ||
      allUserTexts.includes('supermarkt') ||
      allUserTexts.includes('einkaufszentrum')
    );

    const isRoofFire = (
      allUserTexts.includes('dachstuhl') ||
      (allUserTexts.includes('dach') && (allUserTexts.includes('brand') || allUserTexts.includes('feuer') || allUserTexts.includes('rauch')))
    );

    const isSmallFire = (
      allUserTexts.includes('pkw') ||
      allUserTexts.includes('auto brennt') ||
      allUserTexts.includes('mülleimer') ||
      allUserTexts.includes('müll') ||
      allUserTexts.includes('container') ||
      allUserTexts.includes('papierkorb') ||
      allUserTexts.includes('hecke') ||
      allUserTexts.includes('grill') ||
      allUserTexts.includes('kleinbrand')
    );

    const isApartmentFire = !isSchool && !isHospital && !isCommercial && !isRoofFire && !isSmallFire && (
      allUserTexts.includes('brand') ||
      allUserTexts.includes('feuer') ||
      allUserTexts.includes('rauch') ||
      allUserTexts.includes('flammen') ||
      allUserTexts.includes('qualm') ||
      allUserTexts.includes('brennt') ||
      allUserTexts.includes('küche') ||
      allUserTexts.includes('wohnung') ||
      allUserTexts.includes('zimmer') ||
      allUserTexts.includes('haus') ||
      allUserTexts.includes('gebäude')
    );

    const isTrappedCrash = (
      allUserTexts.includes('eingeklemmt') ||
      allUserTexts.includes('überschlagen') ||
      allUserTexts.includes('schwerer unfall') ||
      allUserTexts.includes('frontalkollision') ||
      allUserTexts.includes('lkw') ||
      allUserTexts.includes('mehrere autos') ||
      (allUserTexts.includes('unfall') && (allUserTexts.includes('verletzt') || allUserTexts.includes('blut') || allUserTexts.includes('schwer')))
    );

    const isMassCasualty = (
      allUserTexts.includes('massenanfall') ||
      allUserTexts.includes('manv') ||
      allUserTexts.includes('massenkarambolage') ||
      allUserTexts.includes('zugunglück') ||
      (allUserTexts.includes('bus') && (allUserTexts.includes('unfall') || allUserTexts.includes('brand') || allUserTexts.includes('verletzt'))) ||
      (detectedInjuredCount !== null && detectedInjuredCount >= 5) ||
      allUserTexts.includes('viele verletzte') ||
      allUserTexts.includes('viele menschen verletzt')
    );

    const isMinorCrash = !isTrappedCrash && !isMassCasualty && (
      allUserTexts.includes('unfall') ||
      allUserTexts.includes('auto') ||
      allUserTexts.includes('kollision') ||
      allUserTexts.includes('blechschaden') ||
      allUserTexts.includes('aufgefahren')
    );

    const isResuscitation = (
      allUserTexts.includes('reanimation') ||
      allUserTexts.includes('atmet nicht') ||
      allUserTexts.includes('herzstillstand') ||
      allUserTexts.includes('kein puls') ||
      allUserTexts.includes('wiederbelebung') ||
      allUserTexts.includes('leblos')
    );

    const isMedical = !isResuscitation && (
      allUserTexts.includes('bewusstlos') ||
      allUserTexts.includes('herz') ||
      allUserTexts.includes('schlaganfall') ||
      allUserTexts.includes('blut') ||
      allUserTexts.includes('zusammengebrochen') ||
      allUserTexts.includes('notarzt') ||
      allUserTexts.includes('brustschmerz') ||
      allUserTexts.includes('gestürzt') ||
      allUserTexts.includes('atemnot') ||
      allUserTexts.includes('schmerzen')
    );

    const isGas = (
      allUserTexts.includes('gas') ||
      allUserTexts.includes('gasgeruch') ||
      allUserTexts.includes('faulen eiern') ||
      allUserTexts.includes('ausströmt') ||
      allUserTexts.includes('gefahrgut') ||
      allUserTexts.includes('chemie')
    );

    const isWater = (
      allUserTexts.includes('wasser') ||
      allUserTexts.includes('keller') ||
      allUserTexts.includes('überflutet') ||
      allUserTexts.includes('starkregen') ||
      allUserTexts.includes('rohrbruch') ||
      allUserTexts.includes('hochwasser')
    );

    const isDoor = (
      allUserTexts.includes('türöffnung') ||
      allUserTexts.includes('hilflos') ||
      allUserTexts.includes('eingeschlossen') ||
      allUserTexts.includes('kommt nicht an die tür') ||
      allUserTexts.includes('schlüssel steckt')
    );

    const isBMA = (
      allUserTexts.includes('bma') ||
      allUserTexts.includes('brandmeldeanlage') ||
      allUserTexts.includes('feuermelder piept') ||
      allUserTexts.includes('melder ausgelöst') ||
      allUserTexts.includes('brandmelder')
    );

    const isWaterRescue = (
      allUserTexts.includes('wasserrettung') ||
      (allUserTexts.includes('wasser') && (allUserTexts.includes('ertrink') || allUserTexts.includes('mensch') || allUserTexts.includes('person') || allUserTexts.includes('schwimmer') || allUserTexts.includes('boot') || allUserTexts.includes('förde') || allUserTexts.includes('kanal'))) ||
      allUserTexts.includes('ins wasser gefallen') ||
      allUserTexts.includes('im wasser') ||
      allUserTexts.includes('eisrettung') ||
      allUserTexts.includes('eingebrochen im eis')
    );

    const isTree = (
      (allUserTexts.includes('baum') || allUserTexts.includes('ast')) &&
      (allUserTexts.includes('sturm') || allUserTexts.includes('umgestürzt') || allUserTexts.includes('straße') || allUserTexts.includes('liegt auf') || allUserTexts.includes('abgebrochen'))
    );

    const isFire = isSchool || isHospital || isCommercial || isRoofFire || isApartmentFire || isSmallFire || isBMA;
    const isCrash = isTrappedCrash || isMinorCrash || isMassCasualty;

    // 5-W Status Check
    const wasCompleted = isFire || isCrash || isResuscitation || isMedical || isGas || isWater || isWaterRescue || isTree || isDoor || isMassCasualty || allUserTexts.includes('massenanfall') || allUserTexts.includes('manv') || allUserTexts.length > 8;
    const wieVieleCompleted = (
      detectedInjuredCount !== null ||
      isMassCasualty ||
      allUserTexts.includes('massenanfall') ||
      allUserTexts.includes('manv') ||
      allUserTexts.includes('keine') ||
      allUserTexts.includes('niemand') ||
      allUserTexts.includes('alle') ||
      allUserTexts.includes('draußen') ||
      allUserTexts.includes('allein') ||
      allUserTexts.includes('nur ich') ||
      allUserTexts.includes('lehrer') ||
      allUserTexts.includes('vermisst') ||
      allUserTexts.includes('keiner')
    );
    const welcheGefahrenCompleted = (
      allUserTexts.includes('rauch') ||
      allUserTexts.includes('flamme') ||
      allUserTexts.includes('feuer') ||
      allUserTexts.includes('gas') ||
      allUserTexts.includes('benzin') ||
      allUserTexts.includes('strom') ||
      allUserTexts.includes('gefahr') ||
      allUserTexts.includes('keine gefahr') ||
      allUserTexts.includes('qualm') ||
      allUserTexts.includes('sicher') ||
      allUserTexts.includes('trümmer') ||
      userTurnCount >= 3
    );

    // Check if location is a street without house number (exclude 5-digit Kiel PLZ like 24103!)
    const extractedWithoutPlz = extractedLocation.replace(/\b\d{5}\b/g, '');
    const allUserWithoutPlz = allUserTexts.replace(/\b\d{5}\b/g, '');
    const hasSpokenHouseNum =
      /(?:hausnummer|nummer|nr\.?)\s*(?:\d{1,4}[a-z]?|eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|dreizehn|vierzehn|fünfzehn|zwanzig|dreißig)\b/i.test(allUserWithoutPlz) ||
      /(?:straße|strasse|str\.?|weg|gasse|platz|allee|damm|ring|ufer|chaussee|markt|pfad)\s+(?:\d{1,4}[a-z]?|eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)\b/i.test(allUserWithoutPlz);
    const hasHouseNum = /\b\d{1,4}[a-z]?\b/.test(extractedWithoutPlz) || hasSpokenHouseNum;
    const isAccidentOrRoad = (
      allUserTexts.includes('unfall') ||
      allUserTexts.includes('vu') ||
      allUserTexts.includes('kollision') ||
      allUserTexts.includes('aufgefahren') ||
      allUserTexts.includes('straße') ||
      allUserTexts.includes('ring') ||
      allUserTexts.includes('weg')
    );
    const hasDirectionOrDistrict = (
      allUserTexts.includes('richtung') ||
      allUserTexts.includes('höhe') ||
      allUserTexts.includes('hassee') ||
      allUserTexts.includes('gaarden') ||
      allUserTexts.includes('wik') ||
      allUserTexts.includes('mettenhof') ||
      allUserTexts.includes('ellerbek') ||
      allUserTexts.includes('wellingdorf') ||
      allUserTexts.includes('ravensberg') ||
      allUserTexts.includes('schreventeich') ||
      allUserTexts.includes('suchsdorf') ||
      allUserTexts.includes('russee') ||
      allUserTexts.includes('elmschenhagen') ||
      allUserTexts.includes('holtenau') ||
      allUserTexts.includes('süden') ||
      allUserTexts.includes('norden') ||
      allUserTexts.includes('osten') ||
      allUserTexts.includes('westen') ||
      allUserTexts.includes('stadtauswärts') ||
      allUserTexts.includes('stadteinwärts') ||
      allUserTexts.includes('eckernförde') ||
      allUserTexts.includes('hamburg') ||
      allUserTexts.includes('neumünster') ||
      allUserTexts.includes('flensburg')
    );

    const hasSurroundingsOrCross = (
      allUserTexts.includes('querstraße') ||
      allUserTexts.includes('kreuzung') ||
      allUserTexts.includes('ecke') ||
      allUserTexts.includes('neben') ||
      allUserTexts.includes('gegenüber') ||
      allUserTexts.includes('ampel') ||
      allUserTexts.includes('brücke') ||
      allUserTexts.includes('park') ||
      allUserTexts.includes('haltestelle') ||
      allUserTexts.includes('bahnhof') ||
      allUserTexts.includes('umgebung') ||
      allUserTexts.includes('in der nähe') ||
      allUserTexts.includes('kein haus') ||
      allUserTexts.includes('kein gebäude') ||
      allUserTexts.includes('keine hausnummer') ||
      allUserTexts.includes('höhe') ||
      allUserTexts.includes('richtung')
    );

    const needsHouseNumOrSurroundings = woCompleted && !hasHouseNum && !hasSurroundingsOrCross;
    const needsDirectionAndDistrict = woCompleted && !hasHouseNum && isAccidentOrRoad && !hasDirectionOrDistrict;

    // Determine next 5-W Question strictly in order
    let naechsteFrage = '';
    if (!woCompleted) {
      naechsteFrage = 'An welcher Adresse oder Straße in Kiel befindet sich der Notfallort?';
    } else if (needsHouseNumOrSurroundings) {
      const cleanStreet = extractedLocation.split(',')[0].replace(/\b\d{5}\b/g, '').trim();
      naechsteFrage = `Wo genau in der ${cleanStreet}? Bei welcher Hausnummer? Falls kein Haus in der Nähe ist: Nennen Sie eine nahe Querstraße oder beschreiben Sie die Umgebung!`;
    } else if (needsDirectionAndDistrict) {
      naechsteFrage = 'In welche Fahrtrichtung und auf Höhe welchen Stadtteils befindet sich die Unfallstelle?';
    } else if (!wasCompleted) {
      naechsteFrage = 'Was genau ist passiert?';
    } else if (!wieVieleCompleted) {
      naechsteFrage = 'Wie viele Personen sind verletzt oder in Gefahr?';
    } else if (!welcheGefahrenCompleted) {
      naechsteFrage = 'Welche besonderen Gefahren bestehen vor Ort (z. B. Rauch, Gas, Flammen)?';
    } else {
      naechsteFrage = 'Bleiben Sie am Telefon und bringen Sie sich in Sicherheit.';
    }

    let stichwort = 'NOTFALL - Erstaufnahme';
    let alarmstufe = 1;
    let dringlichkeit = 'HOCH';
    let units: any[] = [];
    let anruferHinweise: string[] = [];
    let shortConfirmation = '';

    if (isSchool) {
      stichwort = 'BR-012 Gebäudebrand – Schule';
      alarmstufe = 3;
      dringlichkeit = 'KRITISCH';
      units = buildTacticalFleet('school_fire', detectedInjuredCount);
      shortConfirmation = userTurnCount <= 1
        ? 'Großalarm Schule: Löschzüge und Rettungsdienst sind alarmiert.'
        : 'Verstanden, weitere Löschfahrzeuge und Rettungswagen rücken an.';
    } else if (isHospital) {
      stichwort = 'BR-014 Gebäudebrand – Krankenhaus';
      alarmstufe = 2;
      dringlichkeit = 'KRITISCH';
      units = buildTacticalFleet('hospital_fire', detectedInjuredCount);
      shortConfirmation = 'Alarm Krankenhaus ausgelöst, Löschzüge und Rettungsdienst rücken aus.';
    } else if (isBMA) {
      stichwort = 'BMA-001 Brandmeldeanlage';
      alarmstufe = 1;
      dringlichkeit = 'MITTEL';
      units = buildTacticalFleet('bma_alarm', detectedInjuredCount);
      shortConfirmation = 'Brandmeldeanlage ausgelöst, Einheiten fahren das Objekt an.';
    } else if (isMassCasualty) {
      stichwort = 'GR-011 MANV-Unterstützung – Massenanfall';
      alarmstufe = 3;
      dringlichkeit = 'KRITISCH';
      units = buildTacticalFleet('mass_casualty', detectedInjuredCount);
      shortConfirmation = 'MANV-Stufe ausgelöst: Mehrere Rettungswagen, Notärzte und Einsatzleiter rücken an.';
    } else if (isTrappedCrash) {
      stichwort = 'TH-021 Eingeklemmte Person – Straße';
      alarmstufe = 2;
      dringlichkeit = 'KRITISCH';
      units = buildTacticalFleet('trapped_crash', detectedInjuredCount);
      shortConfirmation = userTurnCount <= 1
        ? 'Rüstzug mit Hilfeleistungslöschfahrzeugen, Rüstwagen und Rettungsdienst rückt aus.'
        : 'Einsatzkräfte sind mit Sondersignal auf Anfahrt.';
    } else if (isRoofFire) {
      stichwort = 'BR-021 Dachstuhlbrand – Wohngebäude';
      alarmstufe = 2;
      dringlichkeit = 'HOCH';
      units = buildTacticalFleet('roof_fire', detectedInjuredCount);
      shortConfirmation = 'Zwei Löschfahrzeuge, Drehleiter und Rettungsdienst rücken an.';
    } else if (isApartmentFire) {
      const hasTrapped = allUserTexts.includes('vermisst') || allUserTexts.includes('gefahr') || (detectedInjuredCount !== null && detectedInjuredCount > 0);
      stichwort = hasTrapped ? 'BR-009 Wohnungsbrand – Person vermisst' : 'BR-006 Wohnungsbrand – Mehrfamilienhaus';
      alarmstufe = hasTrapped ? 3 : 2;
      dringlichkeit = 'KRITISCH';
      units = buildTacticalFleet('apartment_fire', detectedInjuredCount);
      shortConfirmation = userTurnCount <= 1
        ? 'Löschzug mit zwei HLFs, Drehleiter und Rettungswagen rückt mit Sondersignal aus.'
        : 'Lagebericht wird laufend an die anfahrenden Kräfte übermittelt.';
    } else if (isSmallFire) {
      const isCar = allUserTexts.includes('auto') || allUserTexts.includes('pkw');
      stichwort = isCar ? 'BR-051 Fahrzeugbrand – Pkw' : 'BR-001 Wohnungsbrand – Kleinbrand';
      alarmstufe = 1;
      dringlichkeit = 'HOCH';
      units = buildTacticalFleet('small_fire', detectedInjuredCount);
      shortConfirmation = 'Hilfeleistungslöschfahrzeug und Tanklöschfahrzeug sind alarmiert.';
    } else if (isWaterRescue) {
      stichwort = 'WR-001 Person im Wasser';
      alarmstufe = 2;
      dringlichkeit = 'KRITISCH';
      units = buildTacticalFleet('water_rescue', detectedInjuredCount);
      shortConfirmation = 'Wasserrettungszug mit Rettungsboot, Tauchern und HLF ist alarmiert.';
    } else if (isGas) {
      stichwort = 'ABC-011 Gasgeruch – Gebäude';
      alarmstufe = 2;
      dringlichkeit = 'KRITISCH';
      units = buildTacticalFleet('gas_hazmat', detectedInjuredCount);
      shortConfirmation = 'Gefahrguteinheit der Feuerwehr mit Messgeräten und Rettungsdienst sind alarmiert.';
    } else if (isTree) {
      stichwort = 'TH-051 Sturmschaden – Baum/Ast';
      alarmstufe = 1;
      dringlichkeit = 'MITTEL';
      units = buildTacticalFleet('storm_tree', detectedInjuredCount);
      shortConfirmation = 'Hilfeleistungslöschfahrzeug zur Beseitigung des Sturmschadens ist alarmiert.';
    } else if (isMinorCrash) {
      stichwort = 'TH-001 Verkehrsunfall – Pkw';
      alarmstufe = 1;
      dringlichkeit = 'MITTEL';
      units = buildTacticalFleet('minor_crash', detectedInjuredCount);
      shortConfirmation = 'Hilfeleistungslöschfahrzeug und Rettungswagen sind unterwegs.';
    } else if (isDoor) {
      stichwort = 'TH-036 Türöffnung – Wohngebäude';
      alarmstufe = 1;
      dringlichkeit = 'HOCH';
      units = buildTacticalFleet('door_opening', detectedInjuredCount);
      shortConfirmation = 'Feuerwehr mit Türöffnungssatz und Rettungsdienst sind unterwegs.';
    } else if (isWater) {
      stichwort = 'UW-001 Starkregen – Kellerwohnung / Rohrbruch';
      alarmstufe = 1;
      dringlichkeit = 'MITTEL';
      units = buildTacticalFleet('water_storm', detectedInjuredCount);
      shortConfirmation = 'Löschfahrzeug mit Spezialtauchpumpen ist unterwegs.';
    } else if (isResuscitation) {
      stichwort = 'NOTF NA - Reanimation / Akute Lebensgefahr';
      alarmstufe = 2;
      dringlichkeit = 'KRITISCH';
      units = buildTacticalFleet('resuscitation', detectedInjuredCount);
      shortConfirmation = userTurnCount <= 1
        ? 'Notarzt, Rettungswagen und Feuerwehr First Responder rücken sofort aus.'
        : 'Beginnen Sie sofort mit der Herzdruckmassage, ich bleibe am Telefon.';
    } else if (isMedical) {
      stichwort = 'NOTF 1 - Akuter medizinischer Notfall';
      alarmstufe = 1;
      dringlichkeit = 'HOCH';
      units = buildTacticalFleet('medical', detectedInjuredCount);
      shortConfirmation = 'Rettungswagen und Notarzt sind mit Sondersignal unterwegs.';
    } else {
      stichwort = 'NOTFALL - Erstaufnahme';
      alarmstufe = 1;
      dringlichkeit = 'HOCH';
      units = buildTacticalFleet('general', detectedInjuredCount);
      shortConfirmation = 'Leitstelle 112.';
    }

    // Gate dispatching strictly: ONLY dispatch vehicles if ALL 5-W questions are completed!
    const allWCompleted = Boolean(woCompleted && !needsHouseNumOrSurroundings && !needsDirectionAndDistrict && wasCompleted && wieVieleCompleted && welcheGefahrenCompleted);
    let alarmAusgeloest = false;
    if (allWCompleted && locationGeo) {
      // Nachalarmierung check during active conversation
      const wantsExtraDlk = lastUserLower.includes('drehleiter') || lastUserLower.includes('dlk');
      const wantsExtraRtw = lastUserLower.includes('rettungswagen') || lastUserLower.includes('rtw') || lastUserLower.includes('krankenwagen');
      const wantsExtraHlf = lastUserLower.includes('hlf') || lastUserLower.includes('löschfahrzeug') || lastUserLower.includes('feuerwehrwagen');
      const wantsExtraNef = lastUserLower.includes('notarzt') || lastUserLower.includes('nef');
      const isNachalarmierung = lastUserLower.includes('nachalarm') || lastUserLower.includes('mehr') || lastUserLower.includes('weiter') || lastUserLower.includes('schick') || lastUserLower.includes('brauch');

      if (isNachalarmierung || wantsExtraDlk || wantsExtraRtw || wantsExtraHlf || wantsExtraNef) {
        if (wantsExtraDlk && !units.some((u: any) => u.id === 'extra_dlk')) {
          units.push({
            id: 'extra_dlk',
            code: 'Florian 2/33-2',
            name: 'Drehleiter DLK 23/12 (Nachalarmiert)',
            type: 'DLK 23/12',
            station: 'Feuerwache 2 (Nord)',
            crew: '1/2 (3 Kräfte)',
            status: 'ANFAHRT',
            statusText: 'Status 3 - Nachalarmiert',
            etaMinutes: 1,
            iconType: 'ladder',
          });
        }
        if (wantsExtraRtw && !units.some((u: any) => u.id === 'extra_rtw')) {
          units.push({
            id: 'extra_rtw',
            code: 'Rettung 1/83-9',
            name: 'Rettungswagen RTW (Nachalarmiert)',
            type: 'RTW',
            station: 'Rettungswache 1',
            crew: '1/1 (2 Notfallsanitäter)',
            status: 'ANFAHRT',
            statusText: 'Status 3 - Nachalarmiert',
            etaMinutes: 1,
            iconType: 'ambulance',
          });
        }
        if (wantsExtraHlf && !units.some((u: any) => u.id === 'extra_hlf')) {
          units.push({
            id: 'extra_hlf',
            code: 'Florian 1/46-9',
            name: 'Hilfeleistungslöschfahrzeug HLF 20 (Nachalarmiert)',
            type: 'HLF 20',
            station: 'Feuerwache 1',
            crew: '1/8 (9 Kräfte)',
            status: 'ANFAHRT',
            statusText: 'Status 3 - Nachalarmiert',
            etaMinutes: 1,
            iconType: 'truck',
          });
        }
        if (wantsExtraNef && !units.some((u: any) => u.id === 'extra_nef')) {
          units.push({
            id: 'extra_nef',
            code: 'Notarzt 1/82-2',
            name: 'Notarzteinsatzfahrzeug NEF (Nachalarmiert)',
            type: 'NEF',
            station: 'Klinikum Mitte',
            crew: '1/1 (Notarzt & NotSan)',
            status: 'ANFAHRT',
            statusText: 'Status 3 - Nachalarmiert',
            etaMinutes: 1,
            iconType: 'ambulance',
          });
        }
      }

      units = await assignVehicleCoordinates(units, locationGeo);
      alarmAusgeloest = true;
      shortConfirmation = `Alle 5-W Fragen erfasst. ${units.length} Einsatzmittel nach ${locationGeo.displayName} alarmiert!`;
    } else {
      units = []; // No vehicles dispatched yet!
      alarmAusgeloest = false;
      shortConfirmation = userTurnCount <= 1
        ? 'Notruf 112 – Feuerwehr und Rettungsdienst Kiel.'
        : 'Notruf verstanden.';
    }

    // Combine short confirmation with mandatory 5-W Question at the end
    const dispatcherAntwort = `${shortConfirmation} ${naechsteFrage}`.trim();

    return {
      dispatcherAntwort,
      stichwort: woCompleted ? stichwort : `${stichwort} (Warten auf Straße in Kiel)`,
      alarmstufe,
      dringlichkeit,
      einsatzort: extractedLocation,
      stadt: 'Kiel',
      locationGeo,
      lagebericht: `Notruf gemeldet: ${lastUserMsg.substring(0, 100) || 'Lageabfrage aktiv'}`,
      anruferHinweise: [],
      alarmVollautomatischAusgeloest: alarmAusgeloest,
      naechsteFrage,
      fiveW: {
        wo: {
          completed: woCompleted && !needsHouseNumOrSurroundings && !needsDirectionAndDistrict,
          text: needsHouseNumOrSurroundings
            ? `${extractedLocation} (Hausnummer oder Umgebung wird erfragt)`
            : (needsDirectionAndDistrict ? `${extractedLocation} (Fahrtrichtung & Stadtteil wird erfragt)` : extractedLocation),
          label: '1. Wo in Kiel?',
        },
        was: {
          completed: wasCompleted,
          text: isFire ? 'Brand / Rauchentwicklung' : isCrash ? 'Verkehrsunfall' : isMedical ? 'Medizinischer Notfall' : isGas ? 'Gasaustritt' : isWater ? 'Wasserschaden' : 'Lage erfasst',
          label: '2. Was ist passiert?',
        },
        wieViele: {
          completed: wieVieleCompleted,
          text: wieVieleCompleted ? (detectedInjuredCount !== null ? (detectedInjuredCount === 0 ? 'Keine Verletzten gemeldet' : `${detectedInjuredCount} Person(en) verletzt/betroffen`) : (allUserTexts.includes('keine') || allUserTexts.includes('niemand') || allUserTexts.includes('draußen') ? 'Alle Personen in Sicherheit' : 'Personenstatus erfasst')) : 'Wird erfragt',
          label: '3. Wie viele Verletzte?',
        },
        welcheGefahren: {
          completed: welcheGefahrenCompleted,
          text: welcheGefahrenCompleted ? (isFire ? 'Rauchentwicklung / Flammen' : isGas ? 'Explosionsgefahr' : isCrash ? 'Verkehr / Trümmer' : 'Lagebild erfasst') : 'Wird erfragt',
          label: '4. Welche Gefahren?',
        },
        warten: {
          completed: allWCompleted,
          text: allWCompleted ? 'Alle 5-W Fragen erfasst – Einheiten rücken aus' : 'Warten auf vollständige 5-W Erfassung',
          label: '5. Warten auf Rückfragen',
        },
      },
      alarmierteEinheiten: units,
    };
}

// Speech-to-Text Endpoint using Gemini Transcribe (fallback & cross-browser audio capture)
app.post('/api/dispatcher/transcribe', async (req, res) => {
  try {
    const { audioBase64, mimeType } = req.body;
    if (!audioBase64) {
      return res.status(400).json({ error: 'Missing audio data' });
    }

    const gemini = getGeminiClient();
    if (!gemini) {
      return res.status(503).json({ error: 'Gemini client not configured' });
    }

    const cleanMime = (mimeType || 'audio/webm').split(';')[0];
    const response = await gemini.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: cleanMime,
              data: audioBase64,
            },
          },
          {
            text: 'Transkribiere diese deutsche Sprachnachricht eines 112-Notrufanrufers exakt Wort für Wort. Gib ausschließlich den gesprochenen deutschen Text zurück, ohne Anführungszeichen oder Kommentare. Wenn nur Stille oder Hintergrundrauschen zu hören ist, gib genau einen leeren String zurück.',
          },
        ],
      },
    });

    const transcript = (response.text || '').trim();
    return res.json({ text: transcript });
  } catch (err: any) {
    console.warn('Transcribe error:', err?.message || err);
    return res.status(500).json({ error: 'Transcription failed', message: err?.message });
  }
});

// Natural Neural Text-to-Speech Endpoint using Gemini Flash Lite TTS
app.post('/api/dispatcher/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing text' });
    }

    const gemini = getGeminiClient();
    if (!gemini) {
      return res.status(503).json({ error: 'Gemini client not configured' });
    }

    const cleanText = text
      .replace(/[*_#`~]/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .trim();

    if (!cleanText) {
      return res.status(400).json({ error: 'Empty text' });
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TTS Timeout')), 6500)
    );

    const response: any = await Promise.race([
      gemini.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: cleanText,
                speechMetadata: {
                  style: 'Ruhiger, seriöser, klarer und professioneller deutscher Feuerwehr-Leitstellendisponent am Notruf 112',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Charon' },
            },
          },
        },
      }),
      timeoutPromise,
    ]);

    const base64Audio = response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      return res.status(502).json({ error: 'No audio returned by TTS model' });
    }

    return res.json({
      audioBase64: base64Audio,
      mimeType: 'audio/wav',
    });
  } catch (err: any) {
    console.warn('TTS error:', err?.message || err);
    return res.status(500).json({ error: 'TTS failed', message: err?.message });
  }
});

// Helper to safely send JSON over WebSocket
function sendWsJson(ws: WebSocket, payload: Record<string, any>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

// Live API System Instruction for Real-Time Gemini 3.8 Live German 112 Dispatcher
const LIVE_DISPATCHER_SYSTEM_INSTRUCTION = `Du bist ein professioneller, extrem ruhiger und hochkompetenter Leitstellendisponent der Feuerwehr und des Rettungsdienstes Kiel (Integrierte Regionalleitstelle Mitte, Notruf 112).
Du führst ein direktes Echtzeit-Telefongespräch auf Deutsch mit dem Anrufer.

STRIKTE LEITSTELLEN-REGELN:
1. DER EINSATZORT IST IMMER IN KIEL:
   - Die Stadt Kiel steht IMMER fest! Frage NIEMALS nach der Stadt.
   - Starte beim Abheben direkt kurz mit: "Notruf 112 – Feuerwehr und Rettungsdienst Kiel. An welcher Adresse oder Straße in Kiel befindet sich der Notfallort?"
   - WICHTIG BEI NUR EINEM STRASSENNAMEN (OHNE HAUSNUMMER):
     Wenn der Anrufer nur eine Straße ohne Hausnummer nennt (z. B. "Holstenstraße", "Illerweg", "Westring"), frage sofort nach: "Wo genau in der Straße? Bei welcher Hausnummer? Falls kein Haus in der Nähe ist: Nennen Sie bitte eine nahe Querstraße oder beschreiben Sie die Umgebung."
   - Bei Verkehrsunfällen auf Schnellstraßen oder Ringen frage zusätzlich kurz nach Fahrtrichtung und Stadtteil.

2. 5-W SCHEMA STRIKT & OHNE DOPPELFRAGEN:
   - Frage nacheinander nur die 5-W-Punkte ab, die der Anrufer noch NICHT genannt hat:
     1. Wo in Kiel? (Straße + Hausnummer bzw. Querstraße/Umgebung)
     2. Was genau ist passiert?
     3. Wie viele Personen sind verletzt oder vermisst? (Achtung: Eine Hausnummer ist NIEMALS eine Verletztenzahl!)
     4. Welche besonderen Gefahren bestehen (z. B. Rauch, Flammen, Gas, Eingeklemmte)?
     5. Warten / Alarmierung: Sobald alle 4 Punkte feststehen, löse sofort den Alarm aus!
   - Nennt der Anrufer mehrere Informationen in einem Satz, übernimm alle direkt und stelle NIEMALS bereits beantwortete Fragen erneut.

3. REALISTISCHE AAO-ALARMIERUNG & NACHALARMIERUNG:
   - Sobald alle 4 Punkte vorliegen, bestätige kurz das Einsatzstichwort und die entsandten Fahrzeuge (z. B. HLF 20, DLK 23/12, TLF 4000, ELW, RTW, NEF – bei Bränden ohne Verletzte 1 RTW zur Eigensicherung; bei Schulbrand oder MANV entsprechender Puffer) und sage: "Die Einsatzkräfte sind alarmiert und in 1 Minute vor Ort. Bleiben Sie am Telefon!"
   - Fordert der Anrufer weitere Kräfte nach (z. B. Drehleiter, RTW, HLF, Notarzt), bestätige die Nachalarmierung sofort.

4. SPRECHSTIL:
   - Antworte immer direkt auf Deutsch, natürlich, ruhig und EXTREM KURZ (maximal 1–2 knappe Sätze, direkt zur Sache, keine langen Erklärungen).`;

// Vite middleware configuration + Real-Time Gemini Live WebSocket Server
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/api/live-call' });

  wss.on('connection', async (clientWs) => {
    const gemini = getGeminiClient();
    if (!gemini) {
      sendWsJson(clientWs, {
        type: 'error',
        message: 'Gemini API Key ist auf dem Server nicht konfiguriert.',
      });
      clientWs.close();
      return;
    }

    let isClientClosed = false;
    let liveSession: Awaited<ReturnType<typeof gemini.live.connect>> | null = null;
    let currentUserTurnText = '';
    let currentDispatcherTurnText = '';
    const transcriptHistory: Array<{ sender: 'user' | 'dispatcher'; text: string }> = [];
    let isStarted = false;

    const syncLiveEvaluation = async () => {
      try {
        if (transcriptHistory.length === 0) return;
        const evalResult = await evaluateEmergencyRuleEngine(transcriptHistory);
        sendWsJson(clientWs, {
          type: 'evaluation',
          evaluation: evalResult,
        });
      } catch (evalErr) {
        console.warn('Live evaluation sync failed:', evalErr);
      }
    };

    const finalizePendingUserTurn = () => {
      const cleaned = currentUserTurnText.trim();
      currentUserTurnText = '';
      if (cleaned.length > 0) {
        transcriptHistory.push({ sender: 'user', text: cleaned });
        sendWsJson(clientWs, {
          type: 'user_turn_final',
          text: cleaned,
        });
        void syncLiveEvaluation();
      }
    };

    try {
      const session = await gemini.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Charon' },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: LIVE_DISPATCHER_SYSTEM_INSTRUCTION,
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            if (isClientClosed) return;
            const content = message.serverContent;
            if (!content) return;

            // Live caller speech-to-text captions while speaking
            const interimChunk = (content as any).interimInputTranscription?.text;
            if (interimChunk) {
              sendWsJson(clientWs, {
                type: 'input_transcript_interim',
                text: `${currentUserTurnText}${interimChunk}`,
              });
            }

            const inputChunk = content.inputTranscription?.text;
            if (inputChunk) {
              currentUserTurnText = `${currentUserTurnText}${inputChunk}`;
              sendWsJson(clientWs, {
                type: 'input_transcript',
                text: currentUserTurnText,
              });
            }

            const outputChunk = content.outputTranscription?.text;
            const audioParts = (content.modelTurn?.parts ?? []).filter((p) => p.inlineData?.data);

            // Once model starts speaking/replying, lock in caller's spoken message in the transcript
            if ((outputChunk || audioParts.length > 0) && currentUserTurnText.trim().length > 0) {
              finalizePendingUserTurn();
            }

            // Stream 24kHz PCM audio chunks immediately to browser
            for (const part of audioParts) {
              if (part.inlineData?.data) {
                sendWsJson(clientWs, {
                  type: 'audio',
                  data: part.inlineData.data,
                });
              }
            }

            // Stream dispatcher's spoken words into live transcript
            if (outputChunk) {
              currentDispatcherTurnText = `${currentDispatcherTurnText}${outputChunk}`;
              sendWsJson(clientWs, {
                type: 'output_transcript',
                text: currentDispatcherTurnText,
              });
            }

            // Barge-in / Interruption
            if (content.interrupted) {
              const partialDisp = currentDispatcherTurnText.trim();
              currentDispatcherTurnText = '';
              if (partialDisp.length > 0) {
                const interruptedText = `${partialDisp} …`;
                transcriptHistory.push({ sender: 'dispatcher', text: interruptedText });
                sendWsJson(clientWs, {
                  type: 'dispatcher_turn_final',
                  text: interruptedText,
                  interrupted: true,
                });
              }
              sendWsJson(clientWs, { type: 'interrupted' });
            }

            // End of turn
            if (content.turnComplete) {
              finalizePendingUserTurn();
              const finalDisp = currentDispatcherTurnText.trim();
              currentDispatcherTurnText = '';
              if (finalDisp.length > 0) {
                transcriptHistory.push({ sender: 'dispatcher', text: finalDisp });
                sendWsJson(clientWs, {
                  type: 'dispatcher_turn_final',
                  text: finalDisp,
                });
              }
              sendWsJson(clientWs, { type: 'turn_complete' });
              void syncLiveEvaluation();
            }
          },
          onerror: (err: any) => {
            console.warn('Gemini Live session error:', err);
            sendWsJson(clientWs, {
              type: 'error',
              message: err?.message || 'Verbindungsfehler mit der Live-Sprachleitung.',
            });
          },
          onclose: () => {
            if (!isClientClosed) {
              sendWsJson(clientWs, { type: 'closed' });
            }
          },
        },
      });

      if (isClientClosed) {
        session.close();
        return;
      }

      liveSession = session;
      sendWsJson(clientWs, { type: 'ready' });
    } catch (connectErr: any) {
      console.error('Failed to open Gemini Live session:', connectErr);
      sendWsJson(clientWs, {
        type: 'error',
        message: connectErr?.message || 'Gemini Live Verbindung konnte nicht gestartet werden.',
      });
      clientWs.close();
      return;
    }

    clientWs.on('message', (raw) => {
      if (!liveSession || isClientClosed) return;
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'start' && !isStarted) {
          isStarted = true;
          const scenarioText = typeof msg.initialScenario === 'string' ? msg.initialScenario.trim() : '';
          if (scenarioText) {
            transcriptHistory.push({ sender: 'user', text: scenarioText });
            sendWsJson(clientWs, { type: 'user_turn_final', text: scenarioText });
            void syncLiveEvaluation();
            liveSession.sendRealtimeInput({
              text: `Der 112-Anrufer schildert als erstes folgendes Szenario: "${scenarioText}". Begrüße kurz als Feuerwehr-Disponent Kiel und stelle direkt die erste noch fehlende 5-W-Frage.`,
            });
          } else {
            liveSession.sendRealtimeInput({
              text: 'Der 112-Anrufer hat soeben angerufen. Begrüße ihn sofort kurz und ruhig auf Deutsch mit: "Notruf 112 – Feuerwehr und Rettungsdienst Kiel. An welcher Adresse oder Straße in Kiel befindet sich der Notfallort?"',
            });
          }
        } else if (msg.type === 'audio' && typeof msg.data === 'string') {
          liveSession.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } else if (msg.type === 'text' && typeof msg.text === 'string') {
          const typed = msg.text.trim();
          if (typed) {
            finalizePendingUserTurn();
            transcriptHistory.push({ sender: 'user', text: typed });
            sendWsJson(clientWs, { type: 'user_turn_final', text: typed });
            void syncLiveEvaluation();
            liveSession.sendRealtimeInput({ text: typed });
          }
        }
      } catch (msgErr) {
        console.warn('Invalid WebSocket message from client:', msgErr);
      }
    });

    clientWs.on('close', () => {
      isClientClosed = true;
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // ignore
        }
        liveSession = null;
      }
    });
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Leitstelle 112 Server running on http://localhost:${PORT}`);
  });
}

startServer();
