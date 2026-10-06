/* ==========================================================
   RakshNova – AI Disaster Intelligence & Emergency Response
   Frontend-only prototype. Locations, populations and the risk model
   are fictional / simulated. Weather (Open-Meteo) and earthquake (USGS)
   inputs are fetched live and labelled LIVE. When a feed is unavailable
   the affected values fall back to the labelled SIMULATED model and
   nothing is invented. It is not official emergency data.
   ========================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     Helpers
  --------------------------------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const rand = (a, b) => Math.random() * (b - a) + a;
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10000) / 10000;
  }
  const fmtNum = (n) => Math.round(n).toLocaleString('en-IN');
  function fmtCompact(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (n >= 1e3) return Math.round(n / 1e3) + 'K';
    return String(Math.round(n));
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtClock = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }
  function scrollToId(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }
  function setNum(el, value, formatter) {
    if (!el) return;
    const fmt = formatter || ((v) => String(Math.round(v)));
    const from = parseFloat(el.dataset.v || '0') || 0;
    el.dataset.v = String(value);
    cancelAnimationFrame(el._raf);
    if (reduceMotion || from === value) {
      el.textContent = fmt(value);
      return;
    }
    const start = performance.now();
    const dur = 650;
    const step = (t) => {
      const p = clamp((t - start) / dur, 0, 1);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(from + (value - from) * e);
      if (p < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }

  /* ---------------------------------------------------------
     Static simulation data
  --------------------------------------------------------- */
  const TYPES = ['flood', 'earthquake', 'fire', 'weather'];
  const SEVERITY = ['Minor', 'Moderate', 'Major', 'Severe', 'Extreme'];
  const DENSITY = ['Low', 'Medium', 'High', 'Very High'];

  const ICON_PATHS = {
    flood: '<path d="M12 2.5c2.6 3 4.2 5.2 4.2 7.2a4.2 4.2 0 0 1-8.4 0c0-2 1.6-4.2 4.2-7.2z"/><path d="M2 17c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/><path d="M2 21.5c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/>',
    earthquake: '<path d="M2 12h4l2.5-6 4 12 3-9 2 3H22"/>',
    fire: '<path d="M12 2c1 4-3 6-3 10a3 3 0 0 0 6 0c0-1-.5-2-1-3 3 2 5 5 5 8a7 7 0 0 1-14 0c0-6 5-8 7-15z"/>',
    weather: '<path d="M7 17a5 5 0 1 1 1-9.9A6 6 0 0 1 19.5 9.5 3.8 3.8 0 0 1 18 17z"/><path d="M12 10.5 10 15h3l-2 4.5"/>'
  };
  function icon(type, size) {
    const s = size || 22;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON_PATHS[type] + '</svg>';
  }

  const DISASTERS = {
    flood: { label: 'Flood' },
    earthquake: { label: 'Earthquake' },
    fire: { label: 'Fire' },
    weather: { label: 'Extreme Weather' }
  };

  const LEVEL_META = {
    Low:      { cls: 'lv-low',      rank: 0, priority: 'P4', name: 'Routine',   window: 'Review within 24 h',  status: 'Normal monitoring', alert: 'No active alert',          items: 2 },
    Moderate: { cls: 'lv-moderate', rank: 1, priority: 'P3', name: 'Elevated',  window: 'Prepare within 12 h', status: 'Elevated watch',    alert: 'Watch in effect',          items: 4 },
    High:     { cls: 'lv-high',     rank: 2, priority: 'P2', name: 'Urgent',    window: 'Mobilise within 3 h', status: 'High alert',        alert: 'Warning issued',           items: 5 },
    Critical: { cls: 'lv-critical', rank: 3, priority: 'P1', name: 'Immediate', window: 'Act within 30 min',   status: 'Critical alert',    alert: 'EMERGENCY WARNING active', items: 6 }
  };
  const LEVEL_NAMES = ['Low', 'Moderate', 'High', 'Critical'];
  const levelFor = (score) => (score < 30 ? 'Low' : score < 55 ? 'Moderate' : score < 78 ? 'High' : 'Critical');
  const ALL_LV_CLASSES = ['lv-low', 'lv-moderate', 'lv-high', 'lv-critical'];
  function setLevelClass(el, level) {
    if (!el) return;
    ALL_LV_CLASSES.forEach((c) => el.classList.remove(c));
    el.classList.add(LEVEL_META[level].cls);
  }

  /* Fictional regions: vulnerability is 0..1 per hazard */
  const REGIONS = {
    riverbend:  { name: 'Riverbend Delta',          pop: 1200000, density: 4, vuln: { flood: 0.90, earthquake: 0.30, fire: 0.15, weather: 0.60 }, sites: { open: 'Meridian Sports Ground',  elevated: 'Highfield Community College', shelter: 'Riverbend Civic Hall' } },
    kestrel:    { name: 'Kestrel Bay Coast',        pop: 640000,  density: 3, vuln: { flood: 0.60, earthquake: 0.25, fire: 0.20, weather: 0.90 }, sites: { open: 'Kestrel Heights Park',    elevated: 'Cliffside Arena',             shelter: 'Bayview Reinforced Shelter' } },
    ashridge:   { name: 'Ashridge Foothills',       pop: 210000,  density: 2, vuln: { flood: 0.25, earthquake: 0.45, fire: 0.90, weather: 0.35 }, sites: { open: 'Ashridge Valley Fairground', elevated: 'Cedar Ridge School',       shelter: 'Foothill Relief Centre' } },
    northmoor:  { name: 'Northmoor Highlands',      pop: 130000,  density: 1, vuln: { flood: 0.30, earthquake: 0.85, fire: 0.40, weather: 0.50 }, sites: { open: 'Northmoor Parade Ground', elevated: 'Highmoor Plateau Camp',       shelter: 'Moorgate Town Hall' } },
    sunspire:   { name: 'Sunspire Metro',           pop: 3400000, density: 4, vuln: { flood: 0.45, earthquake: 0.70, fire: 0.35, weather: 0.50 }, sites: { open: 'Sunspire Central Park',   elevated: 'Skyline Stadium',             shelter: 'Metro Convention Centre' } },
    veldt:      { name: 'Veldt Plains',             pop: 90000,   density: 1, vuln: { flood: 0.50, earthquake: 0.15, fire: 0.60, weather: 0.70 }, sites: { open: 'Veldt Open Airfield',     elevated: 'Greenbank Mesa Camp',         shelter: 'Veldt District Hospital Annex' } },
    harborline: { name: 'Harborline Port District', pop: 880000,  density: 3, vuln: { flood: 0.70, earthquake: 0.50, fire: 0.45, weather: 0.80 }, sites: { open: 'Harborline Terminal Lot', elevated: 'Lighthouse Hill School',      shelter: 'Port Authority Storm Shelter' } },
    greywater:  { name: 'Greywater Basin',          pop: 450000,  density: 2, vuln: { flood: 0.85, earthquake: 0.20, fire: 0.10, weather: 0.50 }, sites: { open: 'Greywater Fairgrounds',   elevated: 'Stonebridge High School',     shelter: 'Basin Relief Centre' } }
  };

  /* Live data configuration.
     RakshNova's regions are fictional, so each one is tied to a REAL-WORLD
     reference point whose live weather / earthquake data stands in for it. */
  const LIVE_REF = {
    riverbend:  { place: 'Kolkata',   lat: 22.5726, lon: 88.3639 },
    kestrel:    { place: 'Mumbai',    lat: 19.0760, lon: 72.8777 },
    ashridge:   { place: 'Dehradun',  lat: 30.3165, lon: 78.0322 },
    northmoor:  { place: 'Shillong',  lat: 25.5788, lon: 91.8933 },
    sunspire:   { place: 'Delhi',     lat: 28.6139, lon: 77.2090 },
    veldt:      { place: 'Nagpur',    lat: 21.1458, lon: 79.0882 },
    harborline: { place: 'Chennai',   lat: 13.0827, lon: 80.2707 },
    greywater:  { place: 'Patna',     lat: 25.5941, lon: 85.1376 }
  };
  const LIVE_CFG = {
    weatherUrl: 'https://api.open-meteo.com/v1/forecast',
    quakeUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
    weatherEvery: 10 * 60 * 1000,   // Open-Meteo "current" updates every ~15 min
    quakeEvery: 2 * 60 * 1000,      // USGS feeds update every minute
    staleFactor: 3,                 // a reading older than 3 refresh intervals is no longer used
    timeout: 12000,
    quakeRadiusKm: 300
  };

  /* Fictional high-risk zones (x,y are % positions on the map) */
  const ZONE_DEFS = [
    { id: 'z1',  name: 'Delta Lowlands',          region: 'riverbend',  type: 'flood',      base: 88, pop: 184000, area: 140, x: 24, y: 64 },
    { id: 'z2',  name: 'Kestrel Seafront',        region: 'kestrel',    type: 'weather',    base: 76, pop: 96000,  area: 85,  x: 12, y: 32 },
    { id: 'z3',  name: 'Ashridge Pine Belt',      region: 'ashridge',   type: 'fire',       base: 74, pop: 41000,  area: 310, x: 44, y: 22 },
    { id: 'z4',  name: 'Northmoor Fault Corridor', region: 'northmoor', type: 'earthquake', base: 52, pop: 58000,  area: 220, x: 70, y: 14 },
    { id: 'z5',  name: 'Sunspire Central Grid',   region: 'sunspire',   type: 'earthquake', base: 41, pop: 420000, area: 95,  x: 62, y: 50 },
    { id: 'z6',  name: 'Greywater Floodplain',    region: 'greywater',  type: 'flood',      base: 69, pop: 73000,  area: 190, x: 40, y: 78 },
    { id: 'z7',  name: 'Harborline Docks',        region: 'harborline', type: 'weather',    base: 49, pop: 120000, area: 60,  x: 86, y: 74 },
    { id: 'z8',  name: 'Veldt Grasslands',        region: 'veldt',      type: 'fire',       base: 42, pop: 18000,  area: 400, x: 80, y: 38 },
    { id: 'z9',  name: 'Sunspire Riverside',      region: 'sunspire',   type: 'flood',      base: 52, pop: 150000, area: 70,  x: 56, y: 66 },
    { id: 'z10', name: 'Harborline Storage Yards', region: 'harborline', type: 'fire',      base: 28, pop: 22000,  area: 30,  x: 91, y: 56 }
  ];

  const SEED_ALERT_ZONES = [
    { id: 'z1', mins: 3 }, { id: 'z2', mins: 8 }, { id: 'z3', mins: 15 },
    { id: 'z6', mins: 26 }, { id: 'z4', mins: 41 }, { id: 'z9', mins: 57 }
  ];

  const ACTIONS = {
    flood: {
      Low: 'Monitor river gauges and drainage; no action beyond routine readiness checks.',
      Moderate: 'Issue a flood watch, clear storm drains and pre-position pumps and sandbags at known choke points.',
      High: 'Issue a flood warning, close low-lying underpasses, deploy pumps and boats, and begin phased evacuation of riverside blocks.',
      Critical: 'Trigger a flood emergency: mandatory evacuation of low-lying areas, close embankment roads, launch rescue boats and open all relief shelters now.'
    },
    earthquake: {
      Low: 'Continue routine seismic monitoring; confirm building-safety drills and utility shut-off knowledge.',
      Moderate: 'Raise a seismic watch; inspect critical infrastructure and brief hospitals and schools on drop-cover-hold.',
      High: 'Place search-and-rescue teams on standby, isolate gas to vulnerable grids and pre-clear ambulance corridors.',
      Critical: 'Declare a seismic emergency: deploy urban search-and-rescue, evacuate unsafe structures, cut gas and power to damaged grids and open field hospitals.'
    },
    fire: {
      Low: 'Maintain fire-weather monitoring and keep firebreaks and water sources inspected.',
      Moderate: 'Issue a fire-weather watch, restrict open burning and pre-position crews near the forest interface.',
      High: 'Issue a fire warning, stage crews and aerial support, and prepare downwind communities to evacuate.',
      Critical: 'Declare a fire emergency: evacuate interface and downwind communities, close roads near the perimeter and commit all crews and aerial units.'
    },
    weather: {
      Low: 'Track forecast updates; no action beyond routine readiness and public information.',
      Moderate: 'Issue a weather advisory, secure loose structures and place power-restoration crews on notice.',
      High: 'Issue a severe-weather warning, suspend vulnerable transport, open storm shelters and relocate people from exposed areas.',
      Critical: 'Declare a severe-weather emergency: relocate coastal and exposed residents now, shut down transport and activate shelters and generators.'
    }
  };

  const INSIGHTS = {
    flood: {
      Low: 'River gauges are nominal and drainage is absorbing current rainfall with spare capacity.',
      Moderate: 'Soil saturation is building near {z}; gauge levels are worth watching over the next 6 hours.',
      High: 'Rapid gauge rise projected near {z}; low-lying wards face inundation within hours.',
      Critical: 'Embankment overtopping is likely near {z}; the model projects inundation of low-lying wards imminently.'
    },
    earthquake: {
      Low: 'Seismic sensors show background activity only, with no unusual strain signals.',
      Moderate: 'Minor tremor clustering near {z}; exposure is driven mainly by older building stock. Earthquakes cannot be predicted.',
      High: 'Elevated exposure along {z}; dense, older structures are the most vulnerable if an event occurs.',
      Critical: 'Scenario assumes a strong earthquake near {z}; widespread structural damage and casualties are likely.'
    },
    fire: {
      Low: 'Fuel moisture is adequate and winds are light; ignition risk remains low.',
      Moderate: 'Vegetation is drying near {z}; red-flag conditions are possible if winds strengthen.',
      High: 'Hot, dry, gusty conditions near {z}; fire fronts could spread quickly toward settlements.',
      Critical: 'Active fire front near {z} with wind-driven spotting; interface communities need to leave now.'
    },
    weather: {
      Low: 'Atmospheric conditions are stable, with only isolated showers expected.',
      Moderate: 'Storm cells are developing; {z} may see heavy rain and gusty winds.',
      High: 'A severe storm band is tracking toward {z}; damaging winds and flash flooding are likely.',
      Critical: 'Extreme storm landfall is expected at {z}; destructive winds, surge and widespread outages are projected.'
    }
  };

  const NARRATIVE = {
    flood: 'Floodwater behaviour is driven by terrain, drainage and upstream rainfall; low-lying wards and underpasses are cut off first.',
    earthquake: 'Earthquakes cannot be predicted, so this score reflects exposure, building vulnerability and readiness rather than a forecast.',
    fire: 'Fire spread depends on fuel dryness, wind and slope; smoke can affect communities well beyond the fire perimeter.',
    weather: 'Extreme-weather impact scales with wind, rain and surge; power loss and blocked roads are the most common cascading failures.'
  };

  const FACTOR_SETS = {
    flood: [
      ['River & drainage proximity', 'Low-lying terrain close to rivers and drainage channels'],
      ['Soil saturation & runoff', 'Ground can absorb little additional rainfall']
    ],
    earthquake: [
      ['Fault-line proximity', 'Distance to mapped fault segments and past activity'],
      ['Structural vulnerability', 'Share of older or unreinforced buildings']
    ],
    fire: [
      ['Vegetation dryness', 'Dry fuel load raises ignition and spread rates'],
      ['Wind-driven spread', 'Wind and slope can accelerate the fire front']
    ],
    weather: [
      ['Storm intensity band', 'Wind and rainfall intensity of the incoming system'],
      ['Coastal & open exposure', 'Exposure to surge, gusts and flying debris']
    ]
  };

  const EXPOSED = {
    flood: 'low-lying and riverside blocks',
    earthquake: 'damaged and unreinforced buildings',
    fire: 'wildland-interface and downwind neighbourhoods',
    weather: 'coastal, exposed and temporary-housing areas'
  };
  const ROUTE = {
    flood: 'Use elevated routes and avoid underpasses, causeways and low bridges.',
    earthquake: 'Avoid damaged buildings, bridges and overhead lines; expect aftershocks.',
    fire: 'Travel away from the fire front and across the wind direction; keep headlights on in smoke.',
    weather: 'Move early before winds peak; avoid coastal roads and downed power lines.'
  };
  const SITE_KEY = { flood: 'elevated', earthquake: 'open', fire: 'open', weather: 'shelter' };
  const SITE_KIND = { elevated: 'Elevated assembly point', open: 'Open-ground assembly point', shelter: 'Reinforced shelter' };

  const CONTACTS = [
    { name: 'National Emergency Response', num: '112',  note: 'Police · Fire · Ambulance',    primary: ['flood', 'earthquake', 'fire', 'weather'] },
    { name: 'Fire & Rescue Service',       num: '101',  note: 'Fire and rescue of trapped persons', primary: ['fire'] },
    { name: 'Emergency Ambulance',         num: '108',  note: 'Medical emergencies and casualties', primary: ['earthquake', 'fire'] },
    { name: 'Disaster Management Helpline', num: '1078', note: 'District disaster control room', primary: ['flood', 'weather', 'earthquake'] }
  ];

  const CHECKLISTS = {
    flood: [
      'Confirm river-gauge and rainfall readings with the district control room',
      'Deploy pumps, sandbags and rescue boats to low-lying wards',
      'Close flooded underpasses and embankment roads',
      'Open relief shelters and stage food, water and medical kits',
      'Alert hospitals and utilities (substations, water plants)',
      'Broadcast multilingual evacuation advisories'
    ],
    earthquake: [
      'Activate urban search-and-rescue teams',
      'Shut off gas supply and isolate damaged power grids',
      'Inspect bridges, hospitals and schools for structural safety',
      'Set up open-ground assembly points and field triage',
      'Clear ambulance corridors and restrict non-essential traffic',
      'Broadcast aftershock safety guidance'
    ],
    fire: [
      'Dispatch fire crews and aerial support to the fire front',
      'Establish firebreaks and protect critical infrastructure',
      'Evacuate wildland-interface and downwind communities',
      'Close roads and rail lines near the fire perimeter',
      'Issue a smoke and air-quality health advisory',
      'Stage water tankers and medical units at a safe staging area'
    ],
    weather: [
      'Secure coastal, port and loose infrastructure',
      'Suspend sea, rail and air operations as needed',
      'Pre-position tree-clearing and power restoration crews',
      'Open storm shelters and verify backup generators',
      'Send wind, rain and lightning advisories by SMS',
      'Move vulnerable residents to reinforced shelters'
    ]
  };

  /* ---------------------------------------------------------
     State
  --------------------------------------------------------- */
  const state = {
    zones: [],
    alerts: [],
    alertSeq: 0,
    selectedZoneId: null,
    analysis: null,
    context: null,
    filter: 'all',
    checklist: {},
    dismissedBanner: null,
    tickCount: 0,
    analysisToken: 0,
    briefToken: 0,
    briefTimer: null,
    markers: {},
    areas: {},
    newAlertId: null,
    dismissedZone: {},
    live: {
      weather: { data: null, fetchedAt: 0, lastAttempt: 0, fails: 0, error: '', busy: false, prev: 'wait' },
      quake:   { data: null, fetchedAt: 0, lastAttempt: 0, fails: 0, error: '', busy: false, prev: 'wait' },
      derived: {},
      sig: ''
    }
  };

  const getZone = (id) => state.zones.find((z) => z.id === id);
  const popAffected = (z) => Math.round((z.pop * Math.pow(z.score / 100, 1.3)) / 100) * 100;

  /* ---------------------------------------------------------
     LIVE DATA · Open-Meteo (weather) + USGS (earthquakes)
     Rules:
       1. A LIVE value only ever comes from a successful API response.
       2. If a request fails, or the last good reading is too old,
          the affected zones fall back to the SIMULATED model and are
          labelled SIMULATED. No live-looking value is ever estimated.
  --------------------------------------------------------- */
  const sat = (x, max) => clamp(x / max, 0, 1);
  const feedLabel = (src) => (src === 'quake' ? 'USGS' : 'Open-Meteo');
  const feedOf = (type) => (type === 'earthquake' ? 'quake' : 'weather');

  function modeTag(mode) {
    const m = mode === 'live' ? ['m-live', 'LIVE'] : mode === 'mixed' ? ['m-mixed', 'PARTLY LIVE'] : mode === 'wait' ? ['m-wait', 'CONNECTING'] : ['m-sim', 'SIMULATED'];
    return '<span class="mode-tag ' + m[0] + '">' + m[1] + '</span>';
  }
  function setModeTag(el, mode) {
    if (!el) return;
    const m = mode === 'live' ? ['m-live', 'LIVE'] : mode === 'mixed' ? ['m-mixed', 'PARTLY LIVE'] : mode === 'wait' ? ['m-wait', 'CONNECTING'] : ['m-sim', 'SIMULATED'];
    el.className = 'mode-tag ' + m[0];
    el.textContent = m[1];
  }

  /* A feed is usable only while its last good reading is fresh enough */
  function liveOK(src) {
    const s = state.live[src];
    return !!(s.data && Date.now() - s.fetchedAt <= LIVE_CFG[src + 'Every'] * LIVE_CFG.staleFactor);
  }

  function feedState(src) {
    const s = state.live[src];
    const name = feedLabel(src);
    if (liveOK(src)) {
      return { mode: 'live', note: s.error ? 'The latest refresh failed (' + s.error + '). Still using the reading from ' + fmtClock(s.fetchedAt) + '; retrying.' : '' };
    }
    if (!s.error && !s.data) return { mode: 'wait', note: 'Fetching the first reading…' };
    if (s.data) {
      return { mode: 'sim', note: 'The last reading (' + fmtClock(s.fetchedAt) + ') is too old to use' + (s.error ? ' and the latest refresh failed (' + s.error + ')' : '') + '. Affected values are SIMULATED.' };
    }
    return { mode: 'sim', note: name + ' request failed (' + s.error + '). Nothing is estimated; affected zones use the SIMULATED model.' };
  }

  /* ----- Requests ----- */
  function weatherURL() {
    const ids = Object.keys(LIVE_REF);
    return LIVE_CFG.weatherUrl +
      '?latitude=' + ids.map((i) => LIVE_REF[i].lat).join(',') +
      '&longitude=' + ids.map((i) => LIVE_REF[i].lon).join(',') +
      '&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m' +
      '&hourly=precipitation&past_hours=24&forecast_hours=24&timezone=GMT&wind_speed_unit=kmh';
  }

  async function getJSON(url) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), LIVE_CFG.timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('timed out');
      if (e instanceof SyntaxError) throw new Error('invalid response');
      if (e instanceof TypeError) throw new Error('network error or request blocked');
      throw e;
    } finally {
      clearTimeout(to);
    }
  }

  /* ----- Parsing (strict: anything missing means "no reading") ----- */
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

  function parseWeather(json) {
    const ids = Object.keys(LIVE_REF);
    const arr = Array.isArray(json) ? json : [json];
    if (arr.length !== ids.length) throw new Error('unexpected Open-Meteo response');
    const out = {};
    let usable = 0;
    ids.forEach((id, i) => {
      out[id] = null;
      const r = arr[i];
      const c = r && r.current;
      if (!c) return;
      const t = num(c.temperature_2m), rh = num(c.relative_humidity_2m), pr = num(c.precipitation);
      const ws = num(c.wind_speed_10m), wg = num(c.wind_gusts_10m);
      if (t === null || rh === null || pr === null || ws === null || wg === null || typeof c.time !== 'string') return;
      const h = r.hourly || {};
      const times = h.time || [], precip = h.precipitation || [];
      let past = 0, next = 0, peak = 0, n = 0;
      for (let k = 0; k < times.length; k++) {
        const p = num(precip[k]);
        if (p === null) continue;
        n++;
        if (times[k] <= c.time) past += p;
        else { next += p; peak = Math.max(peak, p); }
      }
      if (n < 40) return; // need (almost) the full 48 h window, otherwise no reading
      out[id] = { temp: t, rh: rh, rainNow: pr, wind: ws, gust: wg, code: num(c.weather_code), past24: past, next24: next, peak1h: peak, time: c.time };
      usable++;
    });
    if (!usable) throw new Error('no usable readings in response');
    return out;
  }

  function parseQuakes(json) {
    if (!json || json.type !== 'FeatureCollection' || !Array.isArray(json.features)) throw new Error('unexpected USGS response');
    return json.features.map((f) => {
      const p = f && f.properties;
      const g = f && f.geometry && f.geometry.coordinates;
      if (!p || !g || num(p.mag) === null || num(g[0]) === null || num(g[1]) === null) return null;
      return { id: f.id, mag: p.mag, place: String(p.place || 'Unnamed location'), time: num(p.time), lon: g[0], lat: g[1], url: typeof p.url === 'string' ? p.url : '' };
    }).filter(Boolean);
  }

  /* ----- Live hazard signals, each 0..1 ----- */
  function weatherSignals(w) {
    const flood = clamp(0.35 * sat(w.past24, 80) + 0.45 * sat(w.next24, 100) + 0.20 * sat(w.rainNow, 15), 0, 1);
    const heat = sat(w.temp - 20, 20), dry = sat(60 - w.rh, 45), wind = sat(w.gust, 60);
    const wetDamp = 1 - 0.7 * sat(w.past24 + w.rainNow, 10);
    const fire = clamp((0.35 * heat + 0.40 * dry + 0.25 * wind) * wetDamp, 0, 1);
    const thunder = w.code !== null && w.code >= 95 ? 0.25 : 0;
    const storm = clamp(0.45 * sat(w.gust, 80) + 0.25 * sat(w.rainNow, 15) + 0.20 * sat(w.peak1h, 25) + thunder, 0, 1);
    return { flood: flood, fire: fire, weather: storm };
  }

  function weatherText(type, w) {
    if (type === 'flood') return 'Rain now ' + w.rainNow.toFixed(1) + ' mm/h · past 24 h ' + Math.round(w.past24) + ' mm · next 24 h ' + Math.round(w.next24) + ' mm';
    if (type === 'fire') return Math.round(w.temp) + '°C · humidity ' + Math.round(w.rh) + '% · gusts ' + Math.round(w.gust) + ' km/h · rain past 24 h ' + Math.round(w.past24) + ' mm';
    return 'Gusts ' + Math.round(w.gust) + ' km/h · wind ' + Math.round(w.wind) + ' km/h · rain now ' + w.rainNow.toFixed(1) + ' mm/h · peak next 24 h ' + w.peak1h.toFixed(1) + ' mm/h' + (w.code !== null && w.code >= 95 ? ' · thunderstorm reported' : '');
  }

  function quakeFor(regionId, quakes) {
    const ref = LIVE_REF[regionId];
    const R = LIVE_CFG.quakeRadiusKm;
    let best = 0, n = 0, top = null;
    quakes.forEach((q) => {
      const dist = haversine(ref.lat, ref.lon, q.lat, q.lon);
      if (dist > R) return;
      n++;
      best = Math.max(best, sat(q.mag - 3, 4) * (1 - dist / R));
      if (!top || q.mag > top.mag) top = { mag: q.mag, dist: dist, place: q.place };
    });
    const signal = n ? clamp(best + Math.min(0.1, 0.02 * (n - 1)), 0, 1) : 0;
    const text = n
      ? n + ' earthquake' + (n > 1 ? 's' : '') + ' within ' + R + ' km in the last 24 h · strongest M' + top.mag.toFixed(1) + ', ' + Math.round(top.dist) + ' km away'
      : 'No USGS-listed earthquakes within ' + R + ' km in the last 24 h';
    return { signal: signal, n: n, top: top, text: text };
  }

  function rebuildDerived() {
    const w = state.live.weather.data;
    const q = state.live.quake.data;
    const out = {};
    Object.keys(LIVE_REF).forEach((id) => {
      const d = { wx: null, quake: null, sig: {}, text: {} };
      const wr = w && w[id];
      if (wr) {
        d.wx = wr;
        const s = weatherSignals(wr);
        ['flood', 'fire', 'weather'].forEach((t) => { d.sig[t] = s[t]; d.text[t] = weatherText(t, wr); });
      }
      if (q) {
        d.quake = quakeFor(id, q);
        d.sig.earthquake = d.quake.signal;
        d.text.earthquake = d.quake.text;
      }
      out[id] = d;
    });
    state.live.derived = out;
  }

  /* Returns the live signal for a region + hazard, or null when it must be SIMULATED */
  function liveSignal(regionId, type) {
    const src = feedOf(type);
    if (!liveOK(src)) return null;
    const d = state.live.derived[regionId];
    if (!d || typeof d.sig[type] !== 'number') return null;
    return { L: d.sig[type], src: feedLabel(src), feed: src, detail: d.text[type], place: LIVE_REF[regionId].place, at: state.live[src].fetchedAt };
  }

  /* Static susceptibility (0..1) blended with the live signal */
  function liveExposure(type, v, L) {
    return type === 'earthquake' ? clamp(v + (1 - v) * 0.7 * L, 0, 1) : clamp(0.6 * v + 0.4 * L, 0, 1);
  }

  /* ----- Feeding live values into the zone model ----- */
  function applyLiveToZones() {
    state.zones.forEach((z) => {
      const live = liveSignal(z.region, z.type);
      z.mode = live ? 'live' : 'sim';
      z.live = live;
      if (live) z.score = clamp(Math.round(liveExposure(z.type, z.base / 100, live.L) * 100), 5, 99);
    });
  }

  function liveSignature() {
    return state.zones.map((z) => z.mode[0]).join('') + '|' + feedState('weather').mode + '|' + feedState('quake').mode;
  }

  function overallMode() {
    const n = state.zones.filter((z) => z.mode === 'live').length;
    if (n === state.zones.length && n > 0) return 'live';
    if (n > 0) return 'mixed';
    return feedState('weather').mode === 'wait' && feedState('quake').mode === 'wait' ? 'wait' : 'sim';
  }

  /* Live zone alerts mirror the live zone score; simulated ones are kept only for zones without live inputs */
  function syncLiveAlerts() {
    let changed = false;
    state.alerts = state.alerts.filter((a) => {
      if (!a.zoneId) return true;
      const z = getZone(a.zoneId);
      if (!z) return true;
      if ((a.mode === 'live') !== (z.mode === 'live')) { changed = true; return false; }
      return true;
    });
    state.zones.forEach((z) => {
      if (z.mode !== 'live') return;
      const existing = state.alerts.find((a) => a.zoneId === z.id && a.mode === 'live');
      // a LIVE alert needs the live signal itself to justify it (with hysteresis), not just static susceptibility
      const justified = z.live && z.live.L >= (existing ? 0.15 : 0.2);
      if (z.score < 30 || !justified) {
        delete state.dismissedZone[z.id];
        if (existing) { state.alerts = state.alerts.filter((a) => a !== existing); changed = true; }
        return;
      }
      const level = levelFor(z.score);
      if (!existing) {
        const d = state.dismissedZone[z.id];
        if (d !== undefined && LEVEL_META[level].rank <= d) return;
        delete state.dismissedZone[z.id];
        const alert = makeZoneAlert(z, 0);
        state.alerts.push(alert);
        state.newAlertId = alert.id;
        changed = true;
        setTimeout(() => { if (state.newAlertId === alert.id) { state.newAlertId = null; renderAlerts(); } }, 6000);
      } else if (existing.level !== level) {
        existing.level = level;
        existing.sev = clamp(Math.ceil(z.score / 20), 1, 5);
        existing.action = ACTIONS[z.type][level];
        existing.source = zoneSourceText(z);
        changed = true;
      }
    });
    if (changed) afterAlertsChanged();
  }

  /* Keep the response/briefing context in step with the (possibly live) zone */
  function syncZoneContext() {
    const ctx = state.context;
    if (!ctx || ctx.source !== 'zone') return;
    const z = getZone(ctx.zoneId);
    if (!z) return;
    const next = contextFromZone(z);
    if (next.level !== ctx.level || next.mode !== ctx.mode) {
      setContext(next);
      if (next.level !== ctx.level) toast(z.name + ' risk level changed to ' + next.level);
    } else {
      ctx.score = next.score;
      ctx.pop = next.pop;
      ctx.liveSnap = next.liveSnap;
    }
  }

  function onLiveChanged() {
    applyLiveToZones();
    state.live.sig = liveSignature();
    syncLiveAlerts();
    updateMap();
    updateOverview();
    renderBanner();
    renderStatus();
    renderStats();
    updateZoneDetailLive();
    syncZoneContext();
    renderLive();
    renderTickNote();
    updateFormMode();
  }

  /* ----- Fetching + automatic refresh ----- */
  async function refreshLive(src) {
    const s = state.live[src];
    if (s.busy) return;
    s.busy = true;
    s.lastAttempt = Date.now();
    renderFeedCard(src);
    try {
      const data = src === 'weather' ? parseWeather(await getJSON(weatherURL())) : parseQuakes(await getJSON(LIVE_CFG.quakeUrl));
      s.data = data;
      s.fetchedAt = Date.now();
      s.error = '';
      s.fails = 0;
    } catch (e) {
      s.fails++;
      s.error = e && e.message ? e.message : 'unknown error';
    } finally {
      s.busy = false;
    }
    rebuildDerived();
    onLiveChanged();
  }

  function nextDue(src) {
    const s = state.live[src];
    const every = LIVE_CFG[src + 'Every'];
    const delay = s.fails ? Math.min(every, 60000 * Math.pow(2, s.fails - 1)) : every;
    return s.lastAttempt + delay;
  }

  function liveScheduler() {
    if (document.hidden) return;
    ['weather', 'quake'].forEach((src) => {
      if (!state.live[src].busy && Date.now() >= nextDue(src)) refreshLive(src);
    });
  }

  /* ----- Rendering the Live Data section ----- */
  const ago = (ts) => {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    return s < 60 ? s + ' s ago' : Math.floor(s / 60) + ' min ago';
  };

  function tickLiveTimes() {
    ['weather', 'quake'].forEach((src) => {
      const s = state.live[src];
      const a = $('#feedAt-' + src);
      const n = $('#feedNext-' + src);
      if (a) a.textContent = s.fetchedAt ? fmtClock(s.fetchedAt) + ' · ' + ago(s.fetchedAt) : 'none yet';
      if (n) {
        const left = Math.max(0, Math.round((nextDue(src) - Date.now()) / 1000));
        n.textContent = s.busy ? 'refreshing…' : document.hidden ? 'paused (tab hidden)' : left >= 60 ? Math.floor(left / 60) + ' min ' + (left % 60) + ' s' : left + ' s';
      }
    });
  }

  function renderFeedCard(src) {
    const el = $(src === 'weather' ? '#feedWeather' : '#feedQuake');
    if (!el) return;
    const s = state.live[src];
    const fs = feedState(src);
    const R = LIVE_CFG.quakeRadiusKm;
    const title = src === 'weather' ? 'Open-Meteo · weather' : 'USGS · earthquakes';
    const what = src === 'weather'
      ? 'Current conditions plus a past/next 24 h precipitation window for ' + Object.keys(LIVE_REF).length + ' reference points. Refreshes every ' + LIVE_CFG.weatherEvery / 60000 + ' min.'
      : 'Every earthquake USGS lists worldwide for the last 24 h, filtered to ' + R + ' km around each reference point. Refreshes every ' + LIVE_CFG.quakeEvery / 60000 + ' min.';
    el.innerHTML =
      '<div class="feed-head"><h3>' + title + '</h3>' + modeTag(fs.mode) + '</div>' +
      '<p class="feed-what">' + what + '</p>' +
      '<dl class="feed-meta"><div><dt>Last good reading</dt><dd id="feedAt-' + src + '"></dd></div>' +
      '<div><dt>Next refresh</dt><dd id="feedNext-' + src + '"></dd></div></dl>' +
      (fs.note ? '<p class="feed-note ' + (fs.mode === 'live' ? 'warn' : 'err') + '" role="status">' + esc(fs.note) + '</p>' : '') +
      '<div class="feed-actions"><button type="button" class="btn btn-ghost btn-sm" data-refresh="' + src + '"' + (s.busy ? ' disabled' : '') + '>' + (s.busy ? 'Refreshing…' : 'Refresh now') + '</button></div>';
    tickLiveTimes();
  }

  function renderLiveTable() {
    const t = $('#liveTable');
    if (!t) return;
    const wOK = liveOK('weather');
    const qOK = liveOK('quake');
    const na = '<span class="na">unavailable</span>';
    const rows = Object.keys(LIVE_REF).map((id) => {
      const d = state.live.derived[id] || { sig: {}, text: {}, wx: null, quake: null };
      const w = wOK ? d.wx : null;
      const q = qOK ? d.quake : null;
      const sig = (label, key, ok) => {
        const has = !!ok && typeof d.sig[key] === 'number';
        return '<span class="sig' + (has ? '' : ' off') + '">' + label + ' <b>' + (has ? Math.round(d.sig[key] * 100) : '—') + '</b></span>';
      };
      return '<tr><th scope="row">' + esc(REGIONS[id].name) + '</th>' +
        '<td>' + esc(LIVE_REF[id].place) + '</td>' +
        '<td>' + (w ? Math.round(w.temp) + '°C · ' + Math.round(w.rh) + '% RH · gusts ' + Math.round(w.gust) + ' km/h' : na) + '</td>' +
        '<td>' + (w ? Math.round(w.past24) + ' / ' + Math.round(w.next24) + ' mm' : na) + '</td>' +
        '<td>' + (q ? (q.n ? q.n + ' · max M' + q.top.mag.toFixed(1) + ' at ' + Math.round(q.top.dist) + ' km' : 'none listed') : na) + '</td>' +
        '<td><div class="sigs">' + sig('Flood', 'flood', w) + sig('Fire', 'fire', w) + sig('Storm', 'weather', w) + sig('Quake', 'earthquake', q) + '</div></td></tr>';
    });
    t.innerHTML =
      '<thead><tr><th scope="col">Region (fictional)</th><th scope="col">Real reference point</th><th scope="col">Weather now</th>' +
      '<th scope="col">Rain past 24 h / next 24 h</th><th scope="col">Quakes ≤' + LIVE_CFG.quakeRadiusKm + ' km, 24 h</th><th scope="col">Live signals (0–100)</th></tr></thead>' +
      '<tbody>' + rows.join('') + '</tbody>';
  }

  function renderQuakeList() {
    const ul = $('#quakeList');
    if (!ul) return;
    if (!liveOK('quake')) {
      ul.innerHTML = '<li class="quake-empty">' + modeTag(feedState('quake').mode) + ' USGS data is not available right now, so no earthquakes are listed. Nothing is estimated.</li>';
      return;
    }
    const R = LIVE_CFG.quakeRadiusKm;
    const items = [];
    state.live.quake.data.forEach((q) => {
      let best = null;
      Object.keys(LIVE_REF).forEach((id) => {
        const d = haversine(LIVE_REF[id].lat, LIVE_REF[id].lon, q.lat, q.lon);
        if (d <= R && (!best || d < best.dist)) best = { id: id, dist: d };
      });
      if (best) items.push({ q: q, ref: best });
    });
    if (!items.length) {
      ul.innerHTML = '<li class="quake-empty">' + modeTag('live') + ' USGS lists no earthquakes within ' + R + ' km of any reference point in the last 24 h.</li>';
      return;
    }
    items.sort((a, b) => b.q.mag - a.q.mag);
    ul.innerHTML = items.slice(0, 6).map((it) => {
      const safeUrl = /^https:\/\/earthquake\.usgs\.gov\//.test(it.q.url);
      return '<li><span class="q-mag">M' + it.q.mag.toFixed(1) + '</span>' +
        '<div><b>' + esc(it.q.place) + '</b><small>' + (it.q.time ? ago(it.q.time) + ' · ' : '') + Math.round(it.ref.dist) + ' km from ' + esc(LIVE_REF[it.ref.id].place) + ' (reference for ' + esc(REGIONS[it.ref.id].name) + ')</small></div>' +
        (safeUrl ? '<a href="' + esc(it.q.url) + '" target="_blank" rel="noopener">USGS details</a>' : '<span></span>') + '</li>';
    }).join('');
  }

  function renderLive() {
    renderFeedCard('weather');
    renderFeedCard('quake');
    renderLiveTable();
    renderQuakeList();
    setModeTag($('#liveOverallTag'), overallMode());
    ['weather', 'quake'].forEach((src) => {
      const s = state.live[src];
      const mode = feedState(src).mode;
      if (mode !== s.prev) {
        if (mode === 'live') toast(feedLabel(src) + (s.prev === 'sim' ? ' restored: LIVE data in use again' : ' connected: LIVE data in use'));
        else if (mode === 'sim') toast(feedLabel(src) + ' unavailable: affected values are SIMULATED');
        s.prev = mode;
      }
    });
  }

  function renderTickNote() {
    const n = state.zones.filter((z) => z.mode === 'live').length;
    const label = $('#tickLabel');
    if (label) {
      label.innerHTML = 'Open-Meteo ' + modeTag(feedState('weather').mode) + ' · USGS ' + modeTag(feedState('quake').mode) +
        ' · ' + n + ' of ' + state.zones.length + ' zones use live inputs, the rest are simulated · scores re-evaluated every 5 s';
    }
    const dot = $('#tickDot');
    if (dot) dot.classList.toggle('off', n === 0);
  }

  function updateFormMode() {
    const chip = $('#formModeChip');
    if (!chip) return;
    const live = liveSignal($('#location').value, $('#disasterType').value);
    chip.className = 'chip ' + (live ? 'chip-live' : 'chip-sim');
    chip.textContent = live ? 'Live-informed' : 'Simulated';
    chip.title = live ? 'This scenario uses live ' + live.src + ' data from the ' + live.place + ' reference point' : 'No live input available for this scenario; the score is fully simulated';
  }

  function zoneSourceText(z) {
    return z.mode === 'live' && z.live ? 'Zone monitor · ' + z.live.src + ' · ' + z.live.place + ' reference point' : 'Zone monitor · simulated';
  }

  function zoneSourceHTML(z) {
    if (z.mode === 'live' && z.live) {
      return modeTag('live') + ' <span class="muted">' + esc(z.live.src) + ' · ' + esc(z.live.place) + ' reference point · ' + fmtClock(z.live.at) + '</span>' +
        '<div class="zd-live">' + esc(z.live.detail) + '</div>';
    }
    const fs = feedState(feedOf(z.type));
    return modeTag(fs.mode === 'wait' ? 'wait' : 'sim') + ' <span class="muted">' +
      (fs.mode === 'wait' ? 'Waiting for the first live reading; the simulated model is shown meanwhile.' : 'No live input for this zone; the score comes from the simulated model.') + '</span>' +
      (fs.note && fs.mode !== 'wait' ? '<div class="zd-live">' + esc(fs.note) + '</div>' : '');
  }

  /* ---------------------------------------------------------
     Risk model (live-informed where a live signal exists, else simulated)
  --------------------------------------------------------- */
  function vulnWord(v) {
    return v >= 0.75 ? 'very high' : v >= 0.5 ? 'elevated' : v >= 0.3 ? 'moderate' : 'low';
  }

  function computeScore(type, regionId, sev, dens) {
    const v = REGIONS[regionId].vuln[type];
    const live = liveSignal(regionId, type);
    const exposure = live ? liveExposure(type, v, live.L) : v;
    const base = 0.40 * exposure + 0.35 * (sev / 5) + 0.25 * (dens / 4);
    // random variation exists only in SIMULATED mode
    let score = Math.round(base * 100 + (live ? 0 : rand(-3, 3)));
    if (exposure > 0.7 && sev >= 4) score += 4;
    return clamp(score, 3, 99);
  }

  function computeFactors(type, regionId, sev, dens) {
    const region = REGIONS[regionId];
    const v = region.vuln[type];
    const live = liveSignal(regionId, type);
    const e = live ? liveExposure(type, v, live.L) : v;
    const h = hash01(regionId + type);
    const set = FACTOR_SETS[type];
    const hazard = DISASTERS[type].label.toLowerCase();
    const list = [
      { label: 'Location hazard exposure', impact: e * 100, note: live
          ? region.name + ' has ' + vulnWord(v) + ' baseline susceptibility to ' + hazard + ' events, adjusted by the live signal'
          : region.name + ' has ' + vulnWord(v) + ' baseline exposure to ' + hazard + ' events' },
      { label: 'Incident severity', impact: (sev / 5) * 100, note: SEVERITY[sev - 1] + ' scenario intensity selected' },
      { label: 'Population density', impact: (dens / 4) * 100, note: DENSITY[dens - 1] + '-density area increases the number of people exposed' },
      { label: set[0][0], impact: clamp(e * 100 * (0.88 + h * 0.24), 8, 99), note: set[0][1] },
      { label: set[1][0], impact: clamp(e * 100 * (1.04 - h * 0.26), 8, 99), note: set[1][1] },
      { label: 'Evacuation difficulty', impact: (dens / 4 * 0.55 + e * 0.45) * 100, note: 'Road capacity and crowd volume slow clearance' }
    ];
    let liveFactor = null;
    if (live) {
      liveFactor = { label: 'Live conditions · ' + live.src, impact: live.L * 100, note: live.detail + ' (' + live.place + ' reference point)', live: true };
      list.push(liveFactor);
    }
    list.forEach((f) => { f.impact = Math.round(clamp(f.impact, 5, 99)); });
    list.sort((a, b) => b.impact - a.impact);
    const top = list.slice(0, 5);
    // the live factor is always shown so the person can see what live data contributed
    if (liveFactor && top.indexOf(liveFactor) === -1) top[4] = liveFactor;
    return top;
  }

  function estimatePop(regionId, score, sev) {
    const frac = Math.pow(score / 100, 2) * 0.35 * (0.6 + (sev / 5) * 0.4);
    return Math.max(500, Math.round((REGIONS[regionId].pop * frac) / 500) * 500);
  }

  function makeContext(o) {
    return Object.assign({}, o, { level: levelFor(o.score) });
  }

  function contextFromZone(z) {
    const r = REGIONS[z.region];
    return makeContext({
      source: 'zone', zoneId: z.id, type: z.type, regionId: z.region,
      locationName: z.name + ' (' + r.name + ')',
      score: z.score, sev: clamp(Math.ceil(z.score / 20), 1, 5), dens: r.density, pop: popAffected(z),
      mode: z.mode === 'live' ? 'live' : 'sim', liveSnap: z.live || null
    });
  }

  /* ---------------------------------------------------------
     Initial / reset data
  --------------------------------------------------------- */
  function seedZones() {
    state.zones = ZONE_DEFS.map((d) => Object.assign({}, d, { score: clamp(d.base + randInt(-3, 3), 5, 99), mode: 'sim', live: null }));
  }

  function alertTitle(level) {
    return level === 'Critical' ? 'Emergency Warning' : level === 'High' ? 'Warning' : 'Watch';
  }

  function makeZoneAlert(z, minsAgo) {
    const level = levelFor(z.score);
    const ctx = contextFromZone(z);
    return {
      id: ++state.alertSeq, type: z.type, regionId: z.region, zoneId: z.id,
      locationName: z.name, level: level, sev: ctx.sev,
      time: Date.now() - minsAgo * 60000, action: ACTIONS[z.type][level], source: zoneSourceText(z),
      mode: z.mode === 'live' ? 'live' : 'sim'
    };
  }

  function seedAlerts() {
    state.alertSeq = 0;
    // seeded history is simulated, so it is only created for zones without live inputs
    state.alerts = SEED_ALERT_ZONES.filter((s) => getZone(s.id).mode !== 'live').map((s) => makeZoneAlert(getZone(s.id), s.mins));
  }

  /* ---------------------------------------------------------
     Aggregates
  --------------------------------------------------------- */
  function typeSummary(type) {
    const zs = state.zones.filter((z) => z.type === type);
    const max = Math.max.apply(null, zs.map((z) => z.score));
    const avg = zs.reduce((a, z) => a + z.score, 0) / zs.length;
    const score = Math.round(0.6 * max + 0.4 * avg);
    const baseMax = Math.max.apply(null, zs.map((z) => z.base));
    const baseAvg = zs.reduce((a, z) => a + z.base, 0) / zs.length;
    const baseScore = Math.round(0.6 * baseMax + 0.4 * baseAvg);
    const top = zs.reduce((a, b) => (b.score > a.score ? b : a));
    const flagged = zs.filter((z) => z.score >= 30);
    return {
      score: score, level: levelFor(score), top: top,
      delta: score - baseScore, count: flagged.length,
      area: flagged.reduce((a, z) => a + z.area, 0)
    };
  }

  function overallIndex() {
    const scores = state.zones.map((z) => z.score);
    const max = Math.max.apply(null, scores);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return Math.round(0.6 * max + 0.4 * avg);
  }

  function highestAlertLevel() {
    let best = null;
    state.alerts.forEach((a) => {
      if (!best || LEVEL_META[a.level].rank > LEVEL_META[best].rank) best = a.level;
    });
    return best;
  }

  /* ---------------------------------------------------------
     Header status, banner, stats
  --------------------------------------------------------- */
  function renderStatus() {
    const lvl = highestAlertLevel() || 'Low';
    const pill = $('#statusPill');
    setLevelClass(pill, lvl);
    $('#statusText').textContent = LEVEL_META[lvl].status;
  }

  function renderBanner() {
    const banner = $('#criticalBanner');
    const crit = state.alerts
      .filter((a) => a.level === 'Critical')
      .sort((a, b) => b.time - a.time)[0];
    if (!crit || state.dismissedBanner === crit.id) {
      banner.hidden = true;
      banner.dataset.alertId = '';
      return;
    }
    banner.hidden = false;
    banner.dataset.alertId = String(crit.id);
    $('#bannerTitle').textContent = 'CRITICAL ' + DISASTERS[crit.type].label.toUpperCase() + ' RISK — ' + crit.locationName;
    const live = crit.mode === 'live';
    $('#bannerSmall').textContent = live ? 'CRITICAL RISK SIGNAL · LIVE INPUTS · NOT AN OFFICIAL WARNING' : 'CRITICAL EMERGENCY WARNING · SIMULATED';
    $('#bannerText').textContent = crit.action + (live ? ' (Prototype risk model fed by live data — not an official warning)' : ' (Simulated alert — prototype only)');
  }

  function renderStats() {
    const idx = overallIndex();
    const lvl = levelFor(idx);
    const m = LEVEL_META[lvl];

    const riskCard = $('#statRiskCard');
    setLevelClass(riskCard, lvl);
    setNum($('#statRisk'), idx);
    const liveN = state.zones.filter((z) => z.mode === 'live').length;
    $('#statRiskSub').textContent = lvl + ' · ' + liveN + ' of ' + state.zones.length + ' zones live-informed';
    setModeTag($('#statModeTag'), overallMode());
    $('#statRiskBar').style.width = idx + '%';
    $('#statRiskBar').parentElement.className = 'bar ' + m.cls;

    const affected = state.zones.filter((z) => z.score >= 50).reduce((a, z) => a + popAffected(z), 0);
    setNum($('#statPeople'), affected, fmtCompact);
    $('#statPeopleSub').textContent = 'Estimated, zones scoring 50+';

    const crit = state.alerts.filter((a) => a.level === 'Critical').length;
    const high = state.alerts.filter((a) => a.level === 'High').length;
    setNum($('#statAlerts'), state.alerts.length);
    $('#statAlertsSub').textContent = crit + ' critical · ' + high + ' high';

    const hz = state.zones.filter((z) => z.score >= 55).length;
    setNum($('#statZones'), hz);
    $('#statZonesSub').textContent = 'of ' + state.zones.length + ' monitored zones';

    const top = highestAlertLevel() || 'Low';
    const pm = LEVEL_META[top];
    const prCard = $('#statPriorityCard');
    setLevelClass(prCard, top);
    $('#statPriority').textContent = pm.priority + ' · ' + pm.name;
    $('#statPrioritySub').textContent = pm.window;
  }

  /* ---------------------------------------------------------
     Overview cards
  --------------------------------------------------------- */
  function buildOverview() {
    const grid = $('#overviewGrid');
    grid.innerHTML = '';
    TYPES.forEach((t) => {
      const el = document.createElement('article');
      el.className = 'ov-card';
      el.dataset.type = t;
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', DISASTERS[t].label + ' overview. Activate to analyse this disaster type.');
      el.innerHTML =
        '<div class="ov-top"><span class="ov-icon">' + icon(t, 24) + '</span>' +
        '<div><h3>' + DISASTERS[t].label + '</h3><span class="ov-trend" data-f="trend"></span><div class="ov-mode"><span class="mode-tag m-wait" data-f="mode">Connecting</span></div></div>' +
        '<span class="badge" data-f="level"></span></div>' +
        '<div class="ov-score"><b data-f="score">0</b><span>/100 risk index</span><span class="bar"><i data-f="bar"></i></span></div>' +
        '<dl class="ov-meta"><div><dt>Affected area</dt><dd data-f="area"></dd></div>' +
        '<div><dt>Alert status</dt><dd data-f="alert"></dd></div></dl>' +
        '<p class="ov-insight"><span class="ai-tag" data-f="aitag">AI insight</span><span data-f="insight"></span></p>';
      const activate = () => {
        $('#disasterType').value = t;
        updateFormMode();
        toast(DISASTERS[t].label + ' loaded into the risk analysis');
        scrollToId('analysis');
      };
      el.addEventListener('click', activate);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
      });
      grid.appendChild(el);
    });
    updateOverview();
  }

  function updateOverview() {
    $$('.ov-card').forEach((el) => {
      const t = el.dataset.type;
      const s = typeSummary(t);
      const m = LEVEL_META[s.level];
      setLevelClass(el, s.level);
      const f = (n) => $('[data-f="' + n + '"]', el);
      f('level').textContent = s.level;
      setNum(f('score'), s.score);
      f('bar').style.width = s.score + '%';
      const tr = f('trend');
      tr.textContent = (s.delta > 0 ? '▲ +' : s.delta < 0 ? '▼ ' : '▬ ') + s.delta + ' vs. baseline';
      tr.className = 'ov-trend ' + (s.delta > 0 ? 'up' : s.delta < 0 ? 'down' : '');
      f('area').textContent = s.count ? s.count + (s.count > 1 ? ' zones' : ' zone') + ' · ' + fmtNum(s.area) + ' km²' : 'None flagged';
      f('alert').textContent = m.alert;
      const zs = state.zones.filter((z) => z.type === t);
      const nLive = zs.filter((z) => z.mode === 'live').length;
      const cardMode = nLive === zs.length ? 'live' : nLive > 0 ? 'mixed' : feedState(feedOf(t)).mode === 'wait' ? 'wait' : 'sim';
      setModeTag(f('mode'), cardMode);
      if (s.top.mode === 'live' && s.top.live) {
        f('aitag').textContent = 'Live reading';
        f('insight').textContent = s.top.name + ': ' + s.top.live.detail + ' (' + s.top.live.src + ', ' + s.top.live.place + ' reference point).';
      } else {
        f('aitag').textContent = 'Simulated insight';
        f('insight').textContent = INSIGHTS[t][s.level].replace('{z}', s.top.name);
      }
    });
  }

  /* ---------------------------------------------------------
     Alerts
  --------------------------------------------------------- */
  function relTime(ts) {
    const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    const h = Math.floor(mins / 60);
    return h + ' h ' + (mins % 60) + ' min ago';
  }
  function clockTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function renderAlerts() {
    const list = $('#alertList');
    $('#alertCount').textContent = String(state.alerts.length);
    if (!state.alerts.length) {
      list.innerHTML = '<div class="alert-empty">No active alerts. Run a risk analysis, or wait for live data (or the labelled simulation) to raise new ones.</div>';
      return;
    }
    const sorted = state.alerts.slice().sort((a, b) => {
      const r = LEVEL_META[b.level].rank - LEVEL_META[a.level].rank;
      return r !== 0 ? r : b.time - a.time;
    });
    list.innerHTML = sorted.map((a) => {
      const m = LEVEL_META[a.level];
      return '<article class="alert-card ' + m.cls + (a.id === state.newAlertId ? ' is-new' : '') + '" data-id="' + a.id + '">' +
        '<div class="alert-ico">' + icon(a.type, 24) + '</div>' +
        '<div class="alert-main">' +
          '<div class="alert-head"><h3>' + DISASTERS[a.type].label + ' ' + alertTitle(a.level) + '</h3>' +
          '<span class="alert-tags"><span class="badge">' + a.level + '</span>' + modeTag(a.mode) + '</span>' +
          '<button type="button" class="alert-dismiss" data-act="dismiss" aria-label="Dismiss this alert">×</button></div>' +
          '<div class="alert-meta">' +
            '<span>Location <b>' + a.locationName + '</b></span>' +
            '<span>Severity <b>' + SEVERITY[a.sev - 1] + '</b></span>' +
            '<span>Time <b data-ts="' + a.time + '">' + clockTime(a.time) + ' · ' + relTime(a.time) + '</b></span>' +
          '</div>' +
          '<p class="alert-action"><b>Recommended action</b>' + a.action + '</p>' +
          '<div class="alert-buttons">' +
            '<button type="button" class="btn btn-sm" data-act="plan">Open response plan</button>' +
            (a.zoneId ? '<button type="button" class="btn btn-ghost btn-sm" data-act="map">Show on map</button>' : '') +
          '</div>' +
          '<small class="muted">Source: ' + esc(a.source) + '</small>' +
        '</div></article>';
    }).join('');
  }

  function refreshTimes() {
    $$('[data-ts]').forEach((el) => {
      const ts = Number(el.dataset.ts);
      el.textContent = clockTime(ts) + ' · ' + relTime(ts);
    });
  }

  function trimAlerts() {
    // live zone alerts mirror the live zone score, so only the other alerts are trimmed
    const trimmable = () => state.alerts.filter((a) => !(a.mode === 'live' && a.zoneId));
    while (trimmable().length > 8) {
      const list = trimmable();
      const oldest = list.reduce((m, a) => (a.time < m.time ? a : m), list[0]);
      state.alerts.splice(state.alerts.indexOf(oldest), 1);
    }
  }

  function afterAlertsChanged() {
    trimAlerts();
    renderAlerts();
    renderBanner();
    renderStatus();
    renderStats();
  }

  function addZoneAlert() {
    // simulated alerts are only generated for zones that have no live inputs
    const pool = state.zones.filter((z) => z.mode !== 'live' && z.score >= 30 && !state.alerts.some((a) => a.zoneId === z.id));
    if (!pool.length) return;
    const weights = pool.map((z) => z.score * z.score);
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let pick = pool[0];
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) { pick = pool[i]; break; }
    }
    const alert = makeZoneAlert(pick, 0);
    state.alerts.push(alert);
    state.newAlertId = alert.id;
    afterAlertsChanged();
    setTimeout(() => { if (state.newAlertId === alert.id) { state.newAlertId = null; renderAlerts(); } }, 6000);
  }

  function contextFromAlert(a) {
    if (a.ctx) return a.ctx;
    const z = getZone(a.zoneId);
    return z ? contextFromZone(z) : null;
  }

  /* ---------------------------------------------------------
     Map
  --------------------------------------------------------- */
  function buildMap() {
    const layer = $('#mapLayer');
    layer.innerHTML = '';
    state.markers = {};
    state.areas = {};
    state.zones.forEach((z) => {
      const r = clamp(Math.sqrt(z.area) / 2.6, 3.2, 11);
      const area = document.createElement('div');
      area.className = 'zone-area';
      area.style.left = z.x + '%';
      area.style.top = z.y + '%';
      area.style.width = (r * 2) + '%';
      layer.appendChild(area);
      state.areas[z.id] = area;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'zone-marker';
      btn.style.left = z.x + '%';
      btn.style.top = z.y + '%';
      btn.dataset.id = z.id;
      btn.innerHTML = '<span class="dot">' + icon(z.type, 16) + '</span><span class="zone-tag">' + z.name + '<em data-f="s"></em></span>';
      btn.addEventListener('click', () => selectZone(z.id, true));
      layer.appendChild(btn);
      state.markers[z.id] = btn;
    });
    updateMap();
  }

  function updateMap() {
    state.zones.forEach((z) => {
      const lvl = levelFor(z.score);
      const m = LEVEL_META[lvl];
      const btn = state.markers[z.id];
      const area = state.areas[z.id];
      if (!btn) return;
      const dim = state.filter !== 'all' && state.filter !== z.type;
      btn.className = 'zone-marker ' + m.cls + (z.id === state.selectedZoneId ? ' selected' : '') + (dim ? ' dim' : '') + (z.mode === 'live' ? ' is-live' : '');
      area.className = 'zone-area ' + m.cls + (dim ? ' dim' : '');
      btn.querySelector('[data-f="s"]').textContent = String(z.score);
      btn.setAttribute('aria-label', z.name + ', ' + DISASTERS[z.type].label + ', ' + lvl + ' risk, score ' + z.score + ' out of 100, ' + (z.mode === 'live' ? 'live inputs' : 'simulated'));
      btn.setAttribute('aria-pressed', z.id === state.selectedZoneId ? 'true' : 'false');
    });
  }

  function selectZone(id, announce) {
    const z = getZone(id);
    if (!z) return;
    state.selectedZoneId = id;
    updateMap();
    renderZoneDetail();
    setContext(contextFromZone(z));
    if (announce) toast('Response plan and briefing updated for ' + z.name);
  }

  function renderZoneDetail() {
    const box = $('#zoneDetail');
    const z = getZone(state.selectedZoneId);
    if (!z) {
      box.className = 'panel zone-detail';
      box.innerHTML = '<div class="zd-empty"><b>No zone selected</b><p>Choose a marker on the map to see its risk details.</p></div>';
      return;
    }
    const lvl = levelFor(z.score);
    const m = LEVEL_META[lvl];
    const r = REGIONS[z.region];
    box.className = 'panel zone-detail ' + m.cls;
    box.dataset.mode = z.mode;
    box.innerHTML =
      '<div class="zd-head"><div class="alert-ico">' + icon(z.type, 24) + '</div>' +
      '<div><h3>' + z.name + '</h3><p>' + r.name + ' · fictional zone</p></div>' +
      '<span class="badge" id="zdBadge">' + lvl + '</span></div>' +
      '<dl class="zd-rows">' +
        '<div class="zd-row"><dt>Location</dt><dd>' + z.name + ', ' + r.name + '</dd></div>' +
        '<div class="zd-row"><dt>Disaster type</dt><dd>' + DISASTERS[z.type].label + '</dd></div>' +
        '<div class="zd-row"><dt>Risk score</dt><dd><div class="zd-score"><b id="zdScore">' + z.score + '</b><span class="bar"><i id="zdBar" style="width:' + z.score + '%"></i></span></div></dd></div>' +
        '<div class="zd-row"><dt>Population affected</dt><dd><b id="zdPop">' + fmtNum(popAffected(z)) + '</b> <span class="muted">of ' + fmtNum(z.pop) + ' residents (est.)</span></dd></div>' +
        '<div class="zd-row"><dt>Data source</dt><dd id="zdSource">' + zoneSourceHTML(z) + '</dd></div>' +
        '<div class="zd-row"><dt>Recommended response</dt><dd id="zdAction">' + ACTIONS[z.type][lvl] + '</dd></div>' +
      '</dl>' +
      '<div class="zd-actions">' +
        '<button type="button" class="btn btn-sm" data-act="zone-analyze">Analyze this zone</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="zone-plan">Open response plan</button>' +
      '</div>';
  }

  function updateZoneDetailLive() {
    const z = getZone(state.selectedZoneId);
    if (!z) return;
    const lvl = levelFor(z.score);
    const box = $('#zoneDetail');
    if (!box.classList.contains(LEVEL_META[lvl].cls) || box.dataset.mode !== z.mode) { renderZoneDetail(); return; }
    const src = $('#zdSource');
    if (src) src.innerHTML = zoneSourceHTML(z);
    const s = $('#zdScore');
    if (s) {
      s.textContent = String(z.score);
      $('#zdBar').style.width = z.score + '%';
      $('#zdPop').textContent = fmtNum(popAffected(z));
    }
  }

  /* ---------------------------------------------------------
     Context → response panel + briefing
  --------------------------------------------------------- */
  function setContext(ctx) {
    state.context = ctx;
    renderResponse();
    renderBriefing();
  }

  function planKey(ctx) {
    return ctx.type + ':' + ctx.regionId + ':' + (ctx.zoneId || 'analysis');
  }

  function evacText(ctx) {
    const e = EXPOSED[ctx.type];
    switch (ctx.level) {
      case 'Critical':
        return 'Mandatory evacuation of ' + e + ' in ' + ctx.locationName + ' within 60 minutes. Move hospitals, care homes and schools first.';
      case 'High':
        return 'Advise phased evacuation of ' + e + ' in ' + ctx.locationName + ' within 3–6 hours, starting with vulnerable residents.';
      case 'Moderate':
        return 'No evacuation yet. Ask residents of ' + e + ' to prepare go-bags, charge phones and know their route.';
      default:
        return 'No evacuation required. Keep monitoring and review household and community evacuation plans.';
    }
  }

  function safeZone(ctx) {
    const region = REGIONS[ctx.regionId];
    const key = SITE_KEY[ctx.type];
    const name = region.sites[key];
    const h = hash01(name + ctx.type);
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const km = (2 + h * 9).toFixed(1);
    const capacity = Math.round((800 + h * 5200) / 100) * 100;
    const dir = dirs[Math.floor(hash01(name) * 8)];
    const status = ctx.level === 'Critical' ? 'Activate now' : ctx.level === 'High' ? 'Open & staffed' : 'On standby';
    return { name: name, kind: SITE_KIND[key], km: km, dir: dir, capacity: capacity, status: status };
  }

  function renderResponse() {
    const ctx = state.context;
    if (!ctx) return;
    const m = LEVEL_META[ctx.level];
    const root = $('#responseRoot');
    setLevelClass(root, ctx.level);

    $('#responseContext').innerHTML =
      '<div class="alert-ico">' + icon(ctx.type, 22) + '</div>' +
      '<div class="rc-text"><b>' + DISASTERS[ctx.type].label + ' · ' + ctx.locationName + '</b>' +
      '<small>Plan source: ' + (ctx.source === 'analysis' ? 'your risk analysis' : ctx.source === 'zone' ? 'selected zone' : 'alert') + ' · risk inputs ' + modeTag(ctx.mode) + '</small></div>' +
      '<span class="badge">' + ctx.level + ' · ' + ctx.score + '%</span>';

    $('#respPriority').innerHTML =
      '<span class="priority-code">' + m.priority + '</span>' +
      '<div class="priority-copy"><b>' + m.name + ' priority</b><small>' + m.window + '</small></div>';

    $('#respEvac').innerHTML =
      '<p class="r-main">' + evacText(ctx) + '</p>' +
      '<div class="r-sub"><span class="tag status">' + (ctx.level === 'Critical' ? 'Mandatory' : ctx.level === 'High' ? 'Advised' : ctx.level === 'Moderate' ? 'Prepare' : 'Not required') + '</span>' +
      '<span class="tag">People exposed <b>' + fmtNum(ctx.pop) + '</b></span></div>' +
      '<p class="fine">' + ROUTE[ctx.type] + '</p>';

    const sz = safeZone(ctx);
    $('#respSafe').innerHTML =
      '<p class="r-main"><b>' + sz.name + '</b></p>' +
      '<p class="muted">' + sz.kind + ' · ' + sz.km + ' km ' + sz.dir + ' of the affected area</p>' +
      '<div class="r-sub"><span class="tag status">' + sz.status + '</span><span class="tag">Capacity <b>~' + fmtNum(sz.capacity) + '</b></span>' +
      '<span class="tag">Site type <b>' + cap(SITE_KEY[ctx.type]) + '</b></span></div>' +
      '<p class="fine">Capacity and distance are simulated values for the prototype.</p>';

    $('#respContacts').innerHTML = CONTACTS.map((c) => {
      const primary = c.primary.indexOf(ctx.type) !== -1;
      return '<li><a href="tel:' + c.num + '"><span class="c-num">' + c.num + '</span>' +
        '<span class="c-copy"><b>' + c.name + '</b><small>' + c.note + '</small></span>' +
        (primary ? '<em>Primary</em>' : '') + '</a></li>';
    }).join('');

    renderChecklist();
  }

  function renderChecklist() {
    const ctx = state.context;
    if (!ctx) return;
    const key = planKey(ctx);
    const count = LEVEL_META[ctx.level].items;
    if (!state.checklist[key]) state.checklist[key] = new Array(6).fill(false);
    const done = state.checklist[key];
    const items = CHECKLISTS[ctx.type].slice(0, count);
    $('#respChecklist').innerHTML = items.map((t, i) =>
      '<li><label><input type="checkbox" data-i="' + i + '"' + (done[i] ? ' checked' : '') + '>' +
      '<span class="box"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg></span>' +
      '<span class="txt">' + t + '</span></label></li>'
    ).join('');
    updateChecklistProgress();
  }

  function updateChecklistProgress() {
    const ctx = state.context;
    if (!ctx) return;
    const count = LEVEL_META[ctx.level].items;
    const done = state.checklist[planKey(ctx)] || [];
    const n = done.slice(0, count).filter(Boolean).length;
    $('#respProgress').textContent = n + ' / ' + count + ' done';
    $('#respProgressBar').style.width = (n / count * 100) + '%';
  }

  /* ---------------------------------------------------------
     AI situation briefing
  --------------------------------------------------------- */
  function generateBriefing(ctx) {
    const m = LEVEL_META[ctx.level];
    const label = DISASTERS[ctx.type].label;
    const sev = SEVERITY[ctx.sev - 1].toLowerCase();
    const den = DENSITY[ctx.dens - 1].toLowerCase();
    const f = computeFactors(ctx.type, ctx.regionId, ctx.sev, ctx.dens);
    const conf = Math.round(72 + hash01(ctx.type + ctx.regionId + ctx.level) * 18);

    let outlook;
    if (ctx.score >= 78) outlook = 'Escalating: conditions are expected to worsen over the next 6 hours without intervention.';
    else if (ctx.score >= 55) outlook = 'Deteriorating: expect rising risk over the next 6–12 hours, so prepare to escalate.';
    else if (ctx.score >= 30) outlook = 'Watchful: no major escalation is expected, but conditions will be reviewed hourly.';
    else outlook = 'Stable: risk is expected to remain low.';
    outlook = 'Rule-based outlook (not a forecast): ' + outlook;

    const snap = ctx.liveSnap;
    const fs = feedState(feedOf(ctx.type));
    const liveSection = snap
      ? {
          title: 'Live data',
          text: 'LIVE · ' + snap.src + ' · ' + snap.place + ' reference point (a real-world stand-in for the fictional region), fetched ' + fmtClock(snap.at) + '. ' + snap.detail + '. These readings feed the risk score.'
        }
      : {
          title: 'Live data',
          text: 'SIMULATED · No live ' + (ctx.type === 'earthquake' ? 'USGS earthquake' : 'Open-Meteo weather') + ' data is available for this region right now' +
            (fs.mode === 'wait' ? ' (still connecting)' : '') + ', so every input below is simulated. ' + (fs.mode !== 'wait' && fs.note ? fs.note : '')
        };

    return [
      {
        title: 'Situation',
        text: ctx.level + ' ' + label.toLowerCase() + ' risk (' + ctx.score + '%) for ' + ctx.locationName + '. Under a ' + sev + ' scenario in a ' + den + '-density area, an estimated ' + fmtNum(ctx.pop) + ' people could be affected.'
      },
      liveSection,
      {
        title: 'Why the model flags this',
        text: 'The strongest drivers are ' + f[0].label.toLowerCase() + ' (' + f[0].impact + '%) and ' + f[1].label.toLowerCase() + ' (' + f[1].impact + '%). ' + NARRATIVE[ctx.type]
      },
      {
        title: 'Recommended priorities',
        text: m.priority + ' ' + m.name + ' — ' + ACTIONS[ctx.type][ctx.level]
      },
      {
        title: 'Outlook & confidence',
        text: outlook + ' Simulated model confidence: ' + conf + '%. ' + (snap ? 'The risk model is a prototype fed with live readings and is not suitable for real-world decisions.' : 'Generated from simulated data and not suitable for real-world decisions.')
      }
    ];
  }

  function renderBriefing() {
    const ctx = state.context;
    if (!ctx) return;
    const m = LEVEL_META[ctx.level];
    const srcLabel = ctx.source === 'analysis' ? 'Your risk analysis' : ctx.source === 'zone' ? 'Selected zone' : 'Opened alert';
    const src = $('#briefingSource');
    src.innerHTML = '<span class="badge ' + m.cls + '">' + ctx.level + ' · ' + ctx.score + '%</span>' + modeTag(ctx.mode) +
      '<span><b>' + srcLabel + ':</b> ' + DISASTERS[ctx.type].label + ' · ' + ctx.locationName + '</span>';

    const sections = generateBriefing(ctx);
    const body = $('#briefingBody');
    const token = ++state.briefToken;
    clearInterval(state.briefTimer);
    body.innerHTML = '';
    const paras = sections.map((s) => {
      const d = document.createElement('div');
      d.className = 'brief-sec';
      const h = document.createElement('h4');
      h.textContent = s.title;
      const p = document.createElement('p');
      d.appendChild(h);
      d.appendChild(p);
      body.appendChild(d);
      return p;
    });
    if (reduceMotion) {
      paras.forEach((p, i) => { p.textContent = sections[i].text; });
      return;
    }
    let si = 0;
    let ci = 0;
    paras[0].classList.add('caret');
    state.briefTimer = setInterval(() => {
      if (token !== state.briefToken) { clearInterval(state.briefTimer); return; }
      const full = sections[si].text;
      ci += 5;
      paras[si].textContent = full.slice(0, ci);
      if (ci >= full.length) {
        paras[si].textContent = full;
        paras[si].classList.remove('caret');
        si++;
        ci = 0;
        if (si >= sections.length) { clearInterval(state.briefTimer); return; }
        paras[si].classList.add('caret');
      }
    }, 16);
  }

  /* ---------------------------------------------------------
     Risk analysis
  --------------------------------------------------------- */
  function readForm() {
    const dens = $('input[name="density"]:checked');
    return {
      type: $('#disasterType').value,
      regionId: $('#location').value,
      sev: Number($('#severity').value),
      dens: dens ? Number(dens.value) : 2
    };
  }

  function showScanning(input) {
    const live = input && liveSignal(input.regionId, input.type);
    $('#resultPanel').innerHTML =
      '<div class="scan"><div class="scan-ring"></div><p id="scanMsg">' + (live ? 'Loading live ' + live.src + ' readings…' : 'Loading simulated hazard layers…') + '</p>' +
      '<div class="scan-bar"><i></i></div></div>';
  }

  function analyzeRisk() {
    const input = readForm();
    const btn = $('#analyzeBtn');
    const token = ++state.analysisToken;
    btn.disabled = true;
    showScanning(input);
    const steps = ['Weighting severity and population density…', 'Scoring location exposure…', 'Drafting recommended actions…'];
    steps.forEach((msg, i) => {
      setTimeout(() => {
        if (token !== state.analysisToken) return;
        const el = $('#scanMsg');
        if (el) el.textContent = msg;
      }, 330 * (i + 1));
    });
    setTimeout(() => {
      if (token !== state.analysisToken) return;
      btn.disabled = false;
      finishAnalysis(input);
    }, reduceMotion ? 50 : 1300);
  }

  function finishAnalysis(input) {
    const region = REGIONS[input.regionId];
    const liveSnap = liveSignal(input.regionId, input.type);
    const score = computeScore(input.type, input.regionId, input.sev, input.dens);
    const ctx = makeContext({
      source: 'analysis', type: input.type, regionId: input.regionId,
      locationName: region.name, score: score, sev: input.sev, dens: input.dens,
      pop: estimatePop(input.regionId, score, input.sev),
      mode: liveSnap ? 'live' : 'sim', liveSnap: liveSnap
    });
    const result = Object.assign({}, ctx, {
      liveSnap: liveSnap,
      factors: computeFactors(input.type, input.regionId, input.sev, input.dens),
      conf: Math.round(72 + hash01(input.type + input.regionId + ctx.level) * 18)
    });
    state.analysis = result;
    renderResult(result);

    if (ctx.level !== 'Low') {
      const alert = {
        id: ++state.alertSeq, type: ctx.type, regionId: ctx.regionId, zoneId: null,
        locationName: region.name, level: ctx.level, sev: ctx.sev, time: Date.now(),
        action: ACTIONS[ctx.type][ctx.level], source: 'Your risk analysis' + (liveSnap ? ' · inputs: ' + liveSnap.src + ', ' + liveSnap.place + ' reference point' : ' · simulated'),
        ctx: ctx, mode: ctx.mode
      };
      state.alerts.push(alert);
      state.newAlertId = alert.id;
      afterAlertsChanged();
      setTimeout(() => { if (state.newAlertId === alert.id) { state.newAlertId = null; renderAlerts(); } }, 6000);
      toast(ctx.level + ' risk: ' + alertTitle(ctx.level).toLowerCase() + ' added to Early Warning Alerts');
    } else {
      toast('Low risk: no alert generated');
    }
    setContext(ctx);
  }

  function renderResult(r) {
    const m = LEVEL_META[r.level];
    const C = 2 * Math.PI * 54;
    const panel = $('#resultPanel');
    panel.innerHTML =
      '<div class="result ' + m.cls + '">' +
        '<div class="result-top">' +
          '<div class="gauge"><svg viewBox="0 0 128 128" aria-hidden="true"><circle class="g-bg" cx="64" cy="64" r="54"/>' +
          '<circle class="g-fg" cx="64" cy="64" r="54" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + C.toFixed(1) + '" data-target="' + (C * (1 - r.score / 100)).toFixed(1) + '"/></svg>' +
          '<div class="gauge-center"><b>' + r.score + '%</b><span>risk</span></div></div>' +
          '<div class="result-head"><span class="badge">' + r.level + ' risk</span>' +
          '<h3>' + DISASTERS[r.type].label + ' · ' + r.locationName + '</h3>' +
          '<p class="muted">' + SEVERITY[r.sev - 1] + ' scenario · ' + DENSITY[r.dens - 1] + ' density · est. ' + fmtNum(r.pop) + ' people exposed</p>' +
          '<p class="src-line">' + (r.liveSnap
            ? modeTag('live') + ' ' + esc(r.liveSnap.src + ' · ' + r.liveSnap.place + ' reference point · ' + fmtClock(r.liveSnap.at) + ': ' + r.liveSnap.detail)
            : modeTag('sim') + ' No live input used for this scenario') + '</p>' +
          '<span class="conf">Simulated model confidence ' + r.conf + '%</span></div>' +
        '</div>' +
        '<h4>Main contributing factors</h4>' +
        '<ul class="factors">' + r.factors.map((f, i) =>
          '<li><span class="f-name">' + f.label + (i === 0 ? '<em>Primary driver</em>' : '') + (f.live ? '<em class="live">LIVE</em>' : '') + '</span><span class="f-val">' + f.impact + '%</span>' +
          '<span class="bar"><i data-w="' + f.impact + '"></i></span><span class="f-note">' + f.note + '</span></li>'
        ).join('') + '</ul>' +
        '<div class="action-box"><h4>Recommended emergency action</h4><p>' + ACTIONS[r.type][r.level] + '</p>' +
        '<div class="action-meta"><span>Priority ' + m.priority + ' · ' + m.name + '</span><span>' + m.window + '</span></div></div>' +
        (r.type === 'earthquake' ? '<p class="sim-note">Earthquakes cannot be predicted. This score represents exposure and readiness risk for the chosen scenario, not a forecast.</p>' : '') +
        '<p class="sim-note">' + (r.liveSnap
          ? 'Prototype · rule-based model fed with LIVE ' + esc(r.liveSnap.src) + ' readings; all other inputs are simulated. Not an official warning or forecast.'
          : 'Prototype · SIMULATED analysis. No live data was available for this scenario. Not official emergency data.') + '</p>' +
        '<div class="result-actions"><button type="button" class="btn btn-primary btn-sm" data-go="response">Open response plan</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-go="briefing">View AI briefing</button></div>' +
      '</div>';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const fg = $('.g-fg', panel);
      if (fg) fg.setAttribute('stroke-dashoffset', fg.getAttribute('data-target'));
      $$('.factors .bar i', panel).forEach((i) => { i.style.width = i.dataset.w + '%'; });
    }));
  }

  function resetResultPanel() {
    state.analysisToken++;
    $('#analyzeBtn').disabled = false;
    $('#resultPanel').innerHTML =
      '<div class="empty-state"><svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>' +
      '<h3>No analysis yet</h3><p>Set the scenario on the left and press <b>Analyze Risk</b> to see the risk score, contributing factors and recommended action, with each input labelled LIVE or SIMULATED.</p>' +
      '<p class="sim-note">Prototype · rule-based analysis · not official emergency data</p></div>';
  }

  /* ---------------------------------------------------------
     Live-style simulation tick
  --------------------------------------------------------- */
  function tick() {
    state.tickCount++;

    // 1. Re-check feed freshness: stale feeds drop their zones back to SIMULATED
    applyLiveToZones();
    if (liveSignature() !== state.live.sig) {
      state.live.sig = liveSignature();
      syncLiveAlerts();
      renderLive();
      updateFormMode();
    }

    // 2. Only zones WITHOUT live inputs use the simulated random walk
    state.zones.forEach((z) => {
      if (z.mode === 'live') return;
      z.score = clamp(Math.round(z.score + (z.base - z.score) * 0.2 + rand(-2.5, 2.5)), 5, 99);
    });

    if (state.tickCount % 4 === 0 && Math.random() < 0.85) addZoneAlert();

    updateMap();
    updateOverview();
    renderStats();
    updateZoneDetailLive();
    syncZoneContext();
    renderTickNote();
  }

  function updateClock() {
    $('#clock').textContent = new Date().toLocaleTimeString([], { hour12: false });
    tickLiveTimes();
  }

  /* ---------------------------------------------------------
     Reset
  --------------------------------------------------------- */
  function applyFormDefaults() {
    $('#disasterType').value = 'flood';
    $('#location').value = 'greywater';
    $('#severity').value = '3';
    $('#severityOut').textContent = SEVERITY[2];
    const d = $('input[name="density"][value="' + REGIONS.greywater.density + '"]');
    if (d) d.checked = true;
  }

  function resetAll() {
    clearInterval(state.briefTimer);
    state.briefToken++;
    state.analysis = null;
    state.filter = 'all';
    state.checklist = {};
    state.dismissedBanner = null;
    state.newAlertId = null;
    state.tickCount = 0;
    state.dismissedZone = {};
    seedZones();
    applyLiveToZones();
    seedAlerts();
    syncLiveAlerts();
    applyFormDefaults();
    resetResultPanel();
    $$('#mapFilters .chip-btn').forEach((b) => b.classList.toggle('active', b.dataset.filter === 'all'));
    const top = state.zones.reduce((a, b) => (b.score > a.score ? b : a));
    state.selectedZoneId = top.id;
    updateMap();
    updateOverview();
    renderAlerts();
    renderBanner();
    renderStatus();
    renderStats();
    renderZoneDetail();
    setContext(contextFromZone(top));
    updateFormMode();
    renderTickNote();
  }

  /* ---------------------------------------------------------
     Setup & events
  --------------------------------------------------------- */
  function populateForm() {
    $('#disasterType').innerHTML = TYPES.map((t) => '<option value="' + t + '">' + DISASTERS[t].label + '</option>').join('');
    $('#location').innerHTML = Object.keys(REGIONS).map((id) => '<option value="' + id + '">' + REGIONS[id].name + '</option>').join('');
  }

  function bindEvents() {
    $('#riskForm').addEventListener('submit', (e) => { e.preventDefault(); analyzeRisk(); });
    $('#severity').addEventListener('input', (e) => { $('#severityOut').textContent = SEVERITY[Number(e.target.value) - 1]; });
    $('#location').addEventListener('change', (e) => {
      const d = $('input[name="density"][value="' + REGIONS[e.target.value].density + '"]');
      if (d) d.checked = true;
      updateFormMode();
    });
    $('#disasterType').addEventListener('change', updateFormMode);

    $('#live').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-refresh]');
      if (!b) return;
      const src = b.dataset.refresh;
      if (Date.now() - state.live[src].lastAttempt < 10000) { toast('Just refreshed. Please wait a few seconds.'); return; }
      refreshLive(src);
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) liveScheduler(); });

    const doReset = () => { resetAll(); toast('Dashboard reset. Live feeds keep running; zones without live data return to the simulation.'); };
    $('#resetBtn').addEventListener('click', doReset);
    $('#resetBtnHeader').addEventListener('click', doReset);

    $('#bannerDismiss').addEventListener('click', () => {
      state.dismissedBanner = Number($('#criticalBanner').dataset.alertId) || null;
      renderBanner();
      toast('Critical warning acknowledged');
    });
    $('#bannerOpen').addEventListener('click', () => {
      const a = state.alerts.find((x) => x.id === Number($('#criticalBanner').dataset.alertId));
      if (a) {
        const ctx = contextFromAlert(a);
        if (ctx) {
          if (a.zoneId) { state.selectedZoneId = a.zoneId; updateMap(); renderZoneDetail(); }
          setContext(ctx);
        }
      }
      scrollToId('response');
    });

    $('#alertList').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const card = btn.closest('.alert-card');
      const a = state.alerts.find((x) => x.id === Number(card.dataset.id));
      if (!a) return;
      const act = btn.dataset.act;
      if (act === 'dismiss') {
        if (a.mode === 'live' && a.zoneId) state.dismissedZone[a.zoneId] = LEVEL_META[a.level].rank;
        state.alerts = state.alerts.filter((x) => x.id !== a.id);
        afterAlertsChanged();
        toast('Alert dismissed');
      } else if (act === 'plan') {
        const ctx = contextFromAlert(a);
        if (ctx) {
          if (a.zoneId) { state.selectedZoneId = a.zoneId; updateMap(); renderZoneDetail(); }
          setContext(ctx);
          scrollToId('response');
        }
      } else if (act === 'map' && a.zoneId) {
        selectZone(a.zoneId, false);
        scrollToId('map');
      }
    });

    $('#mapFilters').addEventListener('click', (e) => {
      const b = e.target.closest('.chip-btn');
      if (!b) return;
      state.filter = b.dataset.filter;
      $$('#mapFilters .chip-btn').forEach((x) => x.classList.toggle('active', x === b));
      updateMap();
    });

    $('#zoneDetail').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      const z = getZone(state.selectedZoneId);
      if (!btn || !z) return;
      if (btn.dataset.act === 'zone-plan') {
        scrollToId('response');
      } else if (btn.dataset.act === 'zone-analyze') {
        const r = REGIONS[z.region];
        $('#disasterType').value = z.type;
        $('#location').value = z.region;
        $('#severity').value = String(clamp(Math.ceil(z.score / 20), 1, 5));
        $('#severityOut').textContent = SEVERITY[Number($('#severity').value) - 1];
        const d = $('input[name="density"][value="' + r.density + '"]');
        if (d) d.checked = true;
        updateFormMode();
        toast('Scenario pre-filled from ' + z.name + '. Press Analyze Risk.');
        scrollToId('analysis');
      }
    });

    $('#resultPanel').addEventListener('click', (e) => {
      const b = e.target.closest('[data-go]');
      if (b) scrollToId(b.dataset.go);
    });

    $('#respChecklist').addEventListener('change', (e) => {
      const cb = e.target.closest('input[type="checkbox"]');
      if (!cb || !state.context) return;
      const key = planKey(state.context);
      if (!state.checklist[key]) state.checklist[key] = new Array(6).fill(false);
      state.checklist[key][Number(cb.dataset.i)] = cb.checked;
      updateChecklistProgress();
    });

    $('#briefingRegen').addEventListener('click', () => {
      if (!state.context) return;
      renderBriefing();
      toast('Briefing regenerated');
    });
  }

  function init() {
    populateForm();
    bindEvents();
    seedZones();
    seedAlerts();
    applyFormDefaults();
    buildOverview();
    buildMap();
    renderAlerts();
    renderBanner();
    renderStatus();
    renderStats();
    const top = state.zones.reduce((a, b) => (b.score > a.score ? b : a));
    state.selectedZoneId = top.id;
    updateMap();
    renderZoneDetail();
    setContext(contextFromZone(top));
    state.live.sig = liveSignature();
    renderLive();
    renderTickNote();
    updateFormMode();
    updateClock();
    setInterval(updateClock, 1000);
    setInterval(tick, 5000);
    setInterval(refreshTimes, 30000);
    // live feeds: first fetch right away, then automatic refresh
    liveScheduler();
    setInterval(liveScheduler, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
