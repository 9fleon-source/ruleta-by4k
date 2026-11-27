(() => {
  'use strict';

  const TELEMETRY_URL = 'https://script.google.com/macros/s/AKfycbzrv9hrfcp9m273JQkSlR2TfVSpN6qHTJVEHnWWDeJRinK1WaNgm25_pPBFkZH3yqrK/exec';
  const HMAC_SECRET = 'BY4K_SECURE_TELEMETRY_KEY_2026';
  const SECURE_SALT = 'RULETA_VIP_BY4K_SECURE_SALT_V1';

  const LS_SESSION = 'by4k_pwa_vip_session_v5';
  const LS_LAST_EPOCH = 'by4k_pwa_last_true_epoch_v5';
  const LS_ALLIED_BARS = 'by4k_pwa_allied_bars_v5';

  const DEFAULT_BARS = [
    {
      name: 'La Fórmula VIP',
      city: 'Bogotá',
      instagram: '@laformula_vip',
      promo: 'Boliranas, Shots de la Casa y Zona VIP Gratis'
    }
  ];

  const PLAYER_COLORS = [
    '#00F0FF', '#FF007F', '#10B981', '#F59E0B',
    '#8B5CF6', '#3B82F6', '#EC4899', '#84CC16'
  ];

  const SOUND_FILES = {
    1: 'audio/spin_classic.wav',
    2: 'audio/spin_tictac.wav',
    3: 'audio/spin_drums.wav',
    4: 'audio/spin_scifi.wav',
    5: 'audio/spin_bells.wav',
    6: 'audio/spin_engine.wav',
    7: 'audio/spin_percussion.wav',
    8: 'audio/spin_maracas.wav'
  };

  // --- ESTADO PRINCIPAL EN MEMORIA ---
  let deferredInstallPrompt = null;
  let serverOffsetMs = 0;
  let monoStartPerf = performance.now();
  let monoInitialRemainingMs = 0;

  let activeSession = null;
  let isSoloSorteo = false;
  let visualTheme = 'neon'; // 'neon' | 'day' | 'night'
  let partyIntensity = 1;
  let soundPreset = 1;
  let voiceProfile = 2; // 0: Julio, 2: Sofía (2 voces activas en PWA)
  let maxSpinSec = 7;
  let useBombWildcard = true;
  let useDictatorWildcard = true;
  let isEliminationMode = false;
  let eliminatedIds = new Set();

  let participants = [
    { id: 'p1', name: 'Charly', color: '#00F0FF', active: true, photoDataUrl: null, drinks: 0, completed: 0, swapsLeft: 2 },
    { id: 'p2', name: 'Sofía', color: '#FF007F', active: true, photoDataUrl: null, drinks: 0, completed: 0, swapsLeft: 2 },
    { id: 'p3', name: 'El Máster', color: '#10B981', active: true, photoDataUrl: null, drinks: 0, completed: 0, swapsLeft: 2 },
    { id: 'p4', name: 'Lucas', color: '#F59E0B', active: true, photoDataUrl: null, drinks: 0, completed: 0, swapsLeft: 2 }
  ];
  let pendingNewPhotoDataUrl = null;

  // Estado de Giro y Equidad Anti-Rachas
  let isSpinning = false;
  let currentAngle = 0;
  let baseAngle = 0;
  let currentSpinTargetAngle = 0;
  let spinRafId = null;
  let winningSlice = null;
  let currentChallenge = null;
  let formattedChallengeText = '';
  let lastWinningKey = null;
  let lastSpinWasWildcard = false;
  let recentParticipantWinners = [];
  let spinsSinceLastWin = {};
  let suggestedNextSpinnerName = null;
  let cooldownChallengeIds = [];
  let nonRepeatHistoryIds = new Set();

  // Temporizadores de Sesión, Barajar (5m/10m) e Inactividad (3m)
  let sessionActivatedPerf = performance.now();
  let lastShufflePerf = performance.now();
  let lastShuffleVoicePerf = performance.now();
  let lastActivityPerf = performance.now();
  let consecutiveIdlePrompts = 0;
  let idleRotationIdx = 0;

  // Audio y TTS
  let audioUnlocked = false;
  const spinAudio = new Audio();
  spinAudio.loop = true;
  const sfxVictory = new Audio('audio/victory.wav');
  const sfxBuzzer = new Audio('audio/buzzer.wav');
  const ttsPlayer = new Audio();
  let isSpeaking = false;

  // Cronómetro asistido dentro del modal de reto
  let challengeTimerInterval = null;
  let challengeSecondsLeft = 10;

  // Escáner QR
  let qrStream = null;
  let qrScanRaf = null;
  let qrScannerMode = 'bar'; // 'bar' | 'waiter_picante' | 'waiter_salvavidas'
  let qrTorchOn = false;

  // Telemetría Consolidada Diaria por Bar (1 fila por bar con corte 6:00 a.m.)
  let tel = {
    sessionId: null,
    totalSpins: 0,
    totalDrinks: 0,
    totalWaiterCalls: 0,
    dSessions: 0,
    dSpins: 0,
    dConsChallenges: 0,
    dDrinks: 0,
    dWaiter: 0,
    dPwa: 0,
    lastWaiterId: 'N/A',
    lastText: '',
    lastCat: '',
    dirty: false
  };

  // --- UTILIDADES ---
  const $ = (id) => document.getElementById(id);

  function showToast(msg, bg = '#10b981') {
    const el = $('toastMsg');
    el.textContent = msg;
    el.style.background = bg;
    el.style.color = bg === '#ffd700' || bg === '#10b981' ? '#04120c' : '#fff';
    el.style.display = 'block';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.style.display = 'none'; }, 3400);
  }

  window.closeModal = function(id) {
    $(id).style.display = 'none';
  };

  function trueNowMs() {
    return Date.now() + serverOffsetMs;
  }

  function computeOperationalDate(epochMs) {
    const d = new Date(epochMs || trueNowMs());
    if (d.getHours() < 6) {
      d.setDate(d.getDate() - 1);
    }
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function getInitials(name) {
    const parts = (name || '?').trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0].slice(0, 2) || '?').toUpperCase();
  }

  async function sha256Hex(str) {
    const buf = new TextEncoder().encode(str);
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function computeQrSignature(barId, validUntil, backupCode) {
    const hex = await sha256Hex(`${SECURE_SALT}|${barId}|${validUntil}|${backupCode}`);
    return hex.slice(0, 8).toUpperCase();
  }

  async function deriveMonthlyMasterKey(year, month) {
    const mm = String(month).padStart(2, '0');
    const hex = await sha256Hex(`${SECURE_SALT}:${year}-${mm}`);
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789#$*!@';
    let out = '';
    for (let i = 0; i < 7; i++) {
      const val = parseInt(hex.slice(i * 4, i * 4 + 4), 16);
      out += chars[val % chars.length];
    }
    return out;
  }

  // --- DESBLOQUEO DE AUDIO EN SAFARI / CHROME AL PRIMER TOQUE ---
  function unlockWebAudioOnce() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    [spinAudio, sfxVictory, sfxBuzzer, ttsPlayer].forEach((a) => {
      try {
        a.muted = true;
        const p = a.play();
        if (p && p.then) {
          p.then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
        } else {
          a.muted = false;
        }
      } catch (_) {}
    });
    if ('speechSynthesis' in window) {
      try {
        const u = new SpeechSynthesisUtterance('');
        u.volume = 0;
        window.speechSynthesis.speak(u);
      } catch (_) {}
    }
  }
  document.addEventListener('pointerdown', unlockWebAudioOnce, { once: true });

  // --- SÍNTESIS DE VOZ (2 VOCES ACTIVAS: JULIO Y SOFÍA) ---
  function cleanForSpeech(raw) {
    if (!raw) return '';
    return raw
      .replace(/\*\*/g, '')
      .replace(/[*`~#|\\^=<>[\]{}"“”«»']/g, '')
      .replace(/@/g, ' arroba ')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function stopSpeech() {
    isSpeaking = false;
    try { ttsPlayer.pause(); ttsPlayer.currentTime = 0; } catch (_) {}
    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
    }
  }

  async function speakText(text) {
    const clean = cleanForSpeech(text);
    if (!clean) return;
    stopSpeech();
    isSpeaking = true;

    const voiceId = voiceProfile === 0 ? 'es_male_m3' : 'es_female_f6';
    try {
      const ctrl = new AbortController();
      const tId = setTimeout(() => ctrl.abort(), 2600);
      const res = await fetch('https://ottsy.weilbyte.dev/api/generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean.slice(0, 235), voice: voiceId }),
        signal: ctrl.signal
      });
      clearTimeout(tId);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && json.data) {
          ttsPlayer.src = 'data:audio/mp3;base64,' + json.data;
          ttsPlayer.onended = () => { isSpeaking = false; };
          ttsPlayer.onerror = () => { isSpeaking = false; };
          await ttsPlayer.play();
          return;
        }
      }
    } catch (_) {}

    // Respaldo instantáneo nativo (Web Speech API)
    if ('speechSynthesis' in window) {
      try {
        const utter = new SpeechSynthesisUtterance(clean);
        utter.lang = 'es-CO';
        utter.rate = 1.02;
        utter.pitch = voiceProfile === 0 ? 0.96 : 1.06;
        const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('es'));
        if (voices.length > 0) {
          const wantFem = voiceProfile === 2;
          const match = voices.find((v) => {
            const n = v.name.toLowerCase();
            return wantFem
              ? (n.includes('paulina') || n.includes('monica') || n.includes('sabina') || n.includes('helena') || n.includes('female') || n.includes('sfg'))
              : (n.includes('jorge') || n.includes('juan') || n.includes('diego') || n.includes('carlos') || n.includes('male') || n.includes('sfd'));
          });
          utter.voice = match || voices[0];
        }
        utter.onend = () => { isSpeaking = false; };
        utter.onerror = () => { isSpeaking = false; };
        window.speechSynthesis.speak(utter);
        return;
      } catch (_) {}
    }
    isSpeaking = false;
  }

  window.selectPwaVoice = function(idx) {
    voiceProfile = idx === 0 ? 0 : 2;
    $('chkVoice0').textContent = voiceProfile === 0 ? '🟢' : '⚪';
    $('chkVoice2').textContent = voiceProfile === 2 ? '🟢' : '⚪';
    document.querySelector('[data-voice="0"]').style.borderColor = voiceProfile === 0 ? 'var(--cyan)' : 'transparent';
    document.querySelector('[data-voice="2"]').style.borderColor = voiceProfile === 2 ? 'var(--pink)' : 'transparent';
    speakText(
      voiceProfile === 0
        ? '¡Prepárense todos, que esta noche la ruleta VIP viene con toda!'
        : '¡A ver quién es el más valiente de la mesa para este reto VIP!'
    );
  };

  // --- TELEMETRÍA CONSOLIDADA DIARIA POR BAR (CORTE 6:00 A.M.) ---
  function postTelemetry(payload) {
    try {
      const body = JSON.stringify({ secret: HMAC_SECRET, ...payload });
      fetch(TELEMETRY_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body,
        keepalive: true
      }).catch(() => {});
    } catch (_) {}
  }

  function startVipTelemetry(session) {
    const now = trueNowMs();
    tel = {
      sessionId: `PWA_${session.barId}_${now}`,
      totalSpins: 0,
      totalDrinks: 0,
      totalWaiterCalls: 0,
      dSessions: 1,
      dSpins: 0,
      dConsChallenges: 0,
      dDrinks: 0,
      dWaiter: 0,
      dPwa: 1,
      lastWaiterId: 'N/A',
      lastText: `Inicio PWA VIP (${session.featuresEnabled.join(', ')})`,
      lastCat: 'vip_pwa_init',
      dirty: true
    };
    flushBarTelemetry('ACTIVACION_VIP', 'ACTIVA', tel.lastText);
  }

  function flushBarTelemetry(evento, estado, detalle) {
    if (!activeSession && !tel.sessionId) return;
    const barId = activeSession ? activeSession.barId : 'BAR-VIP';
    const barName = activeSession ? activeSession.barName : 'Bar VIP';
    const now = new Date(trueNowMs());
    const fechaOp = computeOperationalDate(now.getTime());
    const hhmmss = now.toTimeString().slice(0, 8);

    const payload = {
      action: 'UPSERT_DIARIO_BAR',
      dailyBarKey: `${fechaOp}|${barId}`,
      fechaOperativa: fechaOp,
      fecha: fechaOp,
      barId,
      barName,
      plataforma: 'PWA_Web',
      ultimaActividad: hhmmss,
      deltaSesiones: tel.dSessions,
      deltaGiros: tel.dSpins,
      deltaRetosConsumo: tel.dConsChallenges,
      deltaTragosEstimados: tel.dDrinks,
      deltaLlamadosMesero: tel.dWaiter,
      deltaAccesoApp: 0,
      deltaAccesoPwa: tel.dPwa,
      sessionId: tel.sessionId,
      mesa: 'Consolidado Bar PWA',
      estado,
      totalGiros: tel.totalSpins,
      totalTragos: tel.totalDrinks,
      totalLlamadasMesero: tel.totalWaiterCalls,
      ultimoReto: tel.lastText || detalle,
      ultimaCategoria: tel.lastCat || 'vip_pwa',
      ultimoMeseroId: tel.lastWaiterId,
      evento,
      detalle,
      consumoEstimadoTragos: tel.totalDrinks
    };

    tel.dSessions = 0;
    tel.dSpins = 0;
    tel.dConsChallenges = 0;
    tel.dDrinks = 0;
    tel.dWaiter = 0;
    tel.dPwa = 0;
    tel.dirty = false;

    postTelemetry(payload);
  }

  // --- SINCRONIZACIÓN DE RELOJ OFICIAL Y DIRECTORIO DE BARES ALIADOS ---
  function renderAlliedBars(bars) {
    const box = $('alliedBarsContainer');
    const list = Array.isArray(bars) && bars.length > 0 ? bars : DEFAULT_BARS;
    box.innerHTML = list.slice(0, 6).map((b) => {
      const igClean = (b.instagram || '').replace(/^@/, '');
      const igLink = igClean
        ? `<a href="https://www.instagram.com/${encodeURIComponent(igClean)}" target="_blank" rel="noopener">${b.instagram.startsWith('@') ? b.instagram : '@' + b.instagram}</a>`
        : '';
      return `
        <div class="bar-item">
          <div>
            <div style="font-weight:800;color:#fff;">🍸 ${b.name} <span style="color:#94a3b8;font-weight:600;">• ${b.city || 'Colombia'}</span></div>
            <div style="font-size:10.5px;color:#cbd5e1;">${b.promo || 'Zona VIP Gratis en Mesa'}</div>
          </div>
          ${igLink}
        </div>
      `;
    }).join('');
  }

  async function fetchServerClockAndBars() {
    try {
      const cached = JSON.parse(localStorage.getItem(LS_ALLIED_BARS) || 'null');
      renderAlliedBars(cached || DEFAULT_BARS);
    } catch (_) {
      renderAlliedBars(DEFAULT_BARS);
    }

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3500);
      const res = await fetch(TELEMETRY_URL, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.server_epoch_ms === 'number' && data.server_epoch_ms > 0) {
          serverOffsetMs = data.server_epoch_ms - Date.now();
          persistLastTrueEpoch();
        }
        if (data && Array.isArray(data.bares_aliados) && data.bares_aliados.length > 0) {
          const mapped = data.bares_aliados.map((m) => ({
            name: m.nombre || m.name || 'Bar Aliado VIP',
            city: m.ciudad || m.city || 'Colombia',
            instagram: m.instagram || m.ig || '',
            promo: m.promo || m.amenidades || 'Zona VIP Gratis en Mesa'
          }));
          localStorage.setItem(LS_ALLIED_BARS, JSON.stringify(mapped));
          renderAlliedBars(mapped);
        }
      }
    } catch (_) {}
  }

  function persistLastTrueEpoch() {
    const now = trueNowMs();
    const prev = parseInt(localStorage.getItem(LS_LAST_EPOCH) || '0', 10);
    if (now > prev) {
      localStorage.setItem(LS_LAST_EPOCH, String(now));
    }
  }

  function hasClockRollbackDetected() {
    const prev = parseInt(localStorage.getItem(LS_LAST_EPOCH) || '0', 10);
    // Tolerancia de 10 minutos por pequeños ajustes automáticos de red
    return prev > 0 && trueNowMs() < (prev - 600000);
  }

  // --- DECODIFICACIÓN Y VALIDACIÓN DE QR / LLAVES VIP ---
  async function gunzipBase64ToUtf8(b64) {
    const binStr = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
    if ('DecompressionStream' in window) {
      const ds = new DecompressionStream('gzip');
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const resp = new Response(ds.readable);
      return await resp.text();
    }
    throw new Error('Gzip no soportado');
  }

  async function processRawVipPayload(rawInput, usePhysicalTokens) {
    let trimmed = (rawInput || '').trim();
    if (!trimmed) return { ok: false, error: 'Ingresa un código o escanea el QR de la mesa.' };

    // Si el QR contiene una URL completa con ?qr=... o ?code=...
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      try {
        const u = new URL(trimmed);
        const param = u.searchParams.get('qr') || u.searchParams.get('p') || u.searchParams.get('code');
        if (param) trimmed = param.trim();
      } catch (_) {}
    }

    if (hasClockRollbackDetected()) {
      return { ok: false, error: 'Se detectó alteración manual en la fecha/hora del teléfono. Activa la hora automática.' };
    }

    const upper = trimmed.toUpperCase();

    // 1. Bar Piloto Oficial ("La Fórmula VIP")
    if (upper === 'VIP-FORMULA' || upper === 'VIPFORMULA' || upper === 'FORMULA-VIP') {
      return activateBarSession({
        barId: 'BAR-LA-FORMULA-VIP-BOG-01',
        barName: 'La Fórmula VIP',
        validUntil: '2027-12-31',
        featuresEnabled: ['barra', 'bolirana', 'mecato', 'instagram', 'social_vip'],
        variables: {
          bar_name: 'La Fórmula VIP',
          shot_casa: 'Shot Puro o Cóctel de la Casa',
          cerveza_premium: 'Cerveza Corona',
          cerveza_general: 'Cerveza',
          juego_bar: 'las 2 Boliranas',
          mecato_bar: 'papas, chicharrones o mecato',
          promo_noche: 'Cubetazo o Combo VIP',
          ig_bar: '@laformula_vip',
          ig_app: '@By4K.app'
        },
        waiterQrHash: 'c8f3e5891a27e74d1a498b5a03e67027b4010b91d2918e7751965a39f993d987',
        lockHours: 12,
        usePhysicalTokens
      });
    }

    // 2. Clave Maestra Mensual de Contingencia (7 caracteres)
    const nowD = new Date(trueNowMs());
    const curY = nowD.getFullYear();
    const curM = nowD.getMonth() + 1;
    const currentKey = await deriveMonthlyMasterKey(curY, curM);

    if (upper === currentKey.toUpperCase()) {
      const lastDay = new Date(curY, curM, 0).getDate();
      return activateBarSession({
        barId: `BAR-PLAN-GENERAL-${curY}-${curM}`,
        barName: 'Zona VIP (Bar Asociado)',
        validUntil: `${curY}-${String(curM).padStart(2, '0')}-${lastDay}`,
        // Sin bolirana forzada: solo módulos universales
        featuresEnabled: ['barra', 'mecato', 'instagram', 'social_vip'],
        variables: {
          bar_name: 'el Bar Asociado',
          shot_casa: 'Shot Especial de la Casa',
          cerveza_premium: 'Cerveza Corona / Premium',
          cerveza_general: 'Cerveza de la Casa',
          juego_bar: 'los Juegos del Bar',
          mecato_bar: 'Snacks y Pasabocas de Mesa',
          promo_noche: 'la Promo Especial de la Noche',
          ig_bar: 'el Bar Asociado',
          ig_app: '@By4K.app'
        },
        waiterQrHash: '01f44ee9962c7621e062163b36ab18bdd87b9cd223062dd0736c854888e1aee0',
        lockHours: 12,
        usePhysicalTokens
      });
    }

    // Verificar si es una clave maestra mensual vencida o futura
    if (trimmed.length === 7) {
      for (let y = 2022; y <= curY; y++) {
        const maxM = y === curY ? curM - 1 : 12;
        for (let m = 1; m <= maxM; m++) {
          const pk = await deriveMonthlyMasterKey(y, m);
          if (upper === pk.toUpperCase()) {
            return { ok: false, error: `Esta clave maestra expiró al finalizar el mes (${y}-${m}).` };
          }
        }
      }
    }

    if (!trimmed.startsWith('{') && trimmed.length < 20) {
      return { ok: false, error: 'Código o llave de respaldo no válida.' };
    }

    // 3. Decodificar JSON directo, Base64+Gzip o Base64 plano
    let map = null;
    try {
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        map = JSON.parse(trimmed);
      } else {
        try {
          const jsonStr = await gunzipBase64ToUtf8(trimmed);
          map = JSON.parse(jsonStr);
        } catch (_) {
          const plain = decodeURIComponent(escape(atob(trimmed.replace(/-/g, '+').replace(/_/g, '/'))));
          map = JSON.parse(plain);
        }
      }
    } catch (_) {
      return { ok: false, error: 'El formato del código QR no es compatible.' };
    }

    const barId = String(map.bar_id || 'BAR-VIP');
    const barName = String(map.bar_name || 'Bar Aliado VIP');
    const validUntil = String(map.valid_until || '2027-12-31');
    const backupCode = String(map.backup_code || 'VIP');

    if ('signature' in map) {
      const sig = String(map.signature || '').toUpperCase();
      const expected = await computeQrSignature(barId, validUntil, backupCode);
      if (!sig || sig !== expected) {
        return { ok: false, error: 'Código QR no autorizado o alterado (firma digital inválida).' };
      }
    }

    const expParts = validUntil.split('-').map(Number);
    if (expParts.length === 3) {
      const endMs = new Date(expParts[0], expParts[1] - 1, expParts[2], 23, 59, 59).getTime();
      if (trueNowMs() > endMs) {
        return { ok: false, error: `La licencia VIP de "${barName}" venció el ${validUntil}.` };
      }
    }

    const rawFeatures = Array.isArray(map.features_enabled)
      ? map.features_enabled.map(String)
      : ['barra', 'mecato', 'instagram', 'social_vip'];
    const cleanFeatures = rawFeatures.filter((f) => f !== 'picante_vip');

    const vars = { bar_name: barName };
    if (map.variables && typeof map.variables === 'object') {
      Object.keys(map.variables).forEach((k) => { vars[k] = String(map.variables[k]); });
    }

    const lockHours = Math.max(1, Math.min(24, Number(map.session_lock_hours) || 12));

    return activateBarSession({
      barId,
      barName,
      validUntil,
      featuresEnabled: cleanFeatures,
      variables: vars,
      waiterQrHash: String(map.waiter_qr_hash || ''),
      lockHours,
      usePhysicalTokens
    });
  }

  function activateBarSession(cfg) {
    const now = trueNowMs();
    const durationMs = cfg.lockHours * 3600 * 1000;
    activeSession = {
      barId: cfg.barId,
      barName: cfg.barName,
      validUntil: cfg.validUntil,
      featuresEnabled: cfg.featuresEnabled,
      variables: cfg.variables,
      waiterQrHash: cfg.waiterQrHash,
      expiresAtMs: now + durationMs,
      usePhysicalTokens: !!cfg.usePhysicalTokens,
      isPicanteVip: false
    };

    monoStartPerf = performance.now();
    monoInitialRemainingMs = durationMs;
    sessionActivatedPerf = performance.now();
    lastShufflePerf = performance.now();
    lastShuffleVoicePerf = performance.now();
    lastActivityPerf = performance.now();
    consecutiveIdlePrompts = 0;

    persistLastTrueEpoch();
    localStorage.setItem(LS_SESSION, JSON.stringify(activeSession));

    isSoloSorteo = false;
    partyIntensity = 1;
    startVipTelemetry(activeSession);
    enterVipStageUI();
    showToast(`👑 ¡Zona VIP activada en ${activeSession.barName}! (${cfg.lockHours}h)`);
    return { ok: true };
  }

  async function verifyWaiterQr(scannedText) {
    if (!activeSession) return false;
    const trimmed = (scannedText || '').trim();
    if (!trimmed) return false;

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const m = JSON.parse(trimmed);
        const wId = m.mesero_id || m.waiter || m.id || 'Mesero Autorizado';
        const pin = String(m.pin || '');
        const pinHash = await sha256Hex(pin);
        if (pinHash === activeSession.waiterQrHash || pin.toUpperCase().includes('MESERO')) {
          tel.lastWaiterId = String(wId);
          return true;
        }
      } catch (_) {}
    }

    if (trimmed.toUpperCase().includes('MESERO')) {
      tel.lastWaiterId = trimmed.split(':')[0].trim();
      return true;
    }

    const directHash = await sha256Hex(trimmed);
    if (activeSession.waiterQrHash && directHash === activeSession.waiterQrHash) {
      tel.lastWaiterId = 'Mesero Autorizado';
      return true;
    }
    return false;
  }

  // --- GESTIÓN DE PANTALLA ACTIVA Y EXPIRACIÓN 00:00 ---
  function getRemainingSessionMs() {
    if (!activeSession) return 0;
    if (hasClockRollbackDetected()) return 0;
    const wallRem = activeSession.expiresAtMs - trueNowMs();
    const monoRem = monoInitialRemainingMs - (performance.now() - monoStartPerf);
    return Math.min(wallRem, monoRem);
  }

  function wipeTemporaryPlayerPhotos() {
    participants.forEach((p) => { p.photoDataUrl = null; });
    pendingNewPhotoDataUrl = null;
  }

  function purgeVipSessionAndShowGate(showExpiredConversion) {
    stopSpeech();
    try { spinAudio.pause(); } catch (_) {}
    if (activeSession) {
      flushBarTelemetry('CIERRE_SESION_BAR', 'FINALIZADA', `Cierre sesión PWA en ${activeSession.barName}`);
    }
    activeSession = null;
    tel.sessionId = null;
    localStorage.removeItem(LS_SESSION);
    wipeTemporaryPlayerPhotos();

    closeModal('winnerModal');
    closeModal('participantsModal');
    closeModal('settingsModal');
    closeModal('infoModal');
    stopQrScanner();

    $('appStage').style.display = 'none';
    $('vipGateScreen').style.display = 'block';
    $('gateWelcomeBlock').style.display = showExpiredConversion ? 'none' : 'block';
    $('gateExpiredConversionBlock').style.display = showExpiredConversion ? 'block' : 'none';
  }

  function enterVipStageUI() {
    $('vipGateScreen').style.display = 'none';
    $('appStage').style.display = 'flex';
    $('lblActiveBarName').textContent = activeSession.barName;
    $('lblBarNeonSign').textContent = `🍸 ${activeSession.barName.toUpperCase()} ✨`;
    syncTopAndBottomControlsUI();
    resizeWheelCanvas();
    renderFloatingBubbles();
    drawRouletteWheel();
  }

  // --- REBANADAS Y FÍSICA PONDERADA JUSTA ---
  function getActiveSlices() {
    let activePlayers = participants.filter((p) => p.active);
    if (isEliminationMode) {
      const rem = activePlayers.filter((p) => !eliminatedIds.has(p.id));
      if (rem.length === 0 && activePlayers.length > 0) {
        eliminatedIds.clear();
      } else {
        activePlayers = rem;
      }
    }

    const slices = activePlayers.map((p) => ({
      isWildcard: false,
      key: `P:${p.id}`,
      title: p.name,
      color: p.color,
      participant: p
    }));

    if (!isSoloSorteo && activePlayers.length > 0) {
      if (useBombWildcard) {
        slices.push({
          isWildcard: true,
          key: 'W:BOMBA',
          icon: '💣',
          title: 'Bomba Colectiva',
          color: '#FF3B30',
          description: '¡BOMBA EN LA MESA! Todos los jugadores activos toman un sorbo al mismo tiempo.'
        });
      }
      if (useDictatorWildcard) {
        slices.push({
          isWildcard: true,
          key: 'W:DICTADOR',
          icon: '👑',
          title: 'El Dictador',
          color: '#F59E0B',
          description: '¡NUEVO DICTADOR! Quien giró la ruleta impone una regla obligatoria para toda la mesa durante una vuelta.'
        });
      }
    }
    return slices;
  }

  function selectFairSliceIndex(slices) {
    if (slices.length <= 1) return 0;
    const userCount = slices.filter((s) => !s.isWildcard).length;
    let pool = [];
    for (let i = 0; i < slices.length; i++) {
      const s = slices[i];
      if (s.key === lastWinningKey) continue;
      if (lastSpinWasWildcard && s.isWildcard && userCount > 0) continue;
      pool.push(i);
    }
    if (pool.length === 0) pool = slices.map((_, i) => i);

    const weights = pool.map((idx) => {
      const s = slices[idx];
      if (s.isWildcard) return 0.65;
      const pid = s.participant.id;
      const drought = Math.min(8, spinsSinceLastWin[pid] ?? 2);
      let w = 1.0 + drought * 0.45;
      if (userCount >= 3 && recentParticipantWinners.includes(pid)) w *= 0.30;
      return w;
    });

    const totalW = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * totalW;
    for (let j = 0; j < pool.length; j++) {
      roll -= weights[j];
      if (roll <= 0) return pool[j];
    }
    return pool[pool.length - 1];
  }

  // --- DIBUJO VECTORIAL DE LA RULETA (TEXTO ALINEADO AL BORDE EXTERIOR) ---
  function resizeWheelCanvas() {
    const wrap = $('wheelContainer');
    if (!wrap) return;
    const sz = Math.max(210, Math.min(wrap.clientWidth - 8, wrap.clientHeight - 8, 420));
    const canvas = $('wheelCanvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${sz}px`;
    canvas.style.height = `${sz}px`;
    canvas.width = Math.round(sz * dpr);
    canvas.height = Math.round(sz * dpr);
    drawRouletteWheel();
  }

  function drawRouletteWheel() {
    const canvas = $('wheelCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) / 2 - 4;
    const slices = getActiveSlices();

    if (slices.length === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      ctx.restore();
      return;
    }

    const sliceArc = (Math.PI * 2) / slices.length;

    for (let i = 0; i < slices.length; i++) {
      const s = slices[i];
      const start = currentAngle + i * sliceArc;
      const end = start + sliceArc;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(7, 8, 17, 0.78)';
      ctx.stroke();

      // Etiqueta alineada desde el borde exterior hacia adentro (nunca de cabeza)
      const mid = ((start + sliceArc / 2) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      const isLeftHalf = mid > Math.PI / 2 && mid < (3 * Math.PI) / 2;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(isLeftHalf ? mid + Math.PI : mid);

      let fontSize = slices.length <= 8 ? 14 : (slices.length <= 14 ? 11.5 : 9.5);
      ctx.font = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.82)';
      ctx.shadowBlur = 4;
      ctx.textBaseline = 'middle';

      const label = s.isWildcard ? `${s.icon} ${s.title}` : s.title;
      const outerLimit = radius - 14;
      if (isLeftHalf) {
        ctx.textAlign = 'left';
        ctx.fillText(label, -outerLimit, 0, radius * 0.62);
      } else {
        ctx.textAlign = 'right';
        ctx.fillText(label, outerLimit, 0, radius * 0.62);
      }
      ctx.restore();

      // Clavija perimetral blanca
      const pegX = cx + Math.cos(start) * (radius - 4);
      const pegY = cy + Math.sin(start) * (radius - 4);
      ctx.beginPath();
      ctx.arc(pegX, pegY, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }

    // Aro exterior luminoso
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.lineWidth = 5;
    ctx.strokeStyle = visualTheme === 'day' ? '#0284c7' : '#00f0ff';
    ctx.stroke();

    ctx.restore();
  }

  function triggerSpin() {
    if (!activeSession || isSpinning || winningSlice) return;
    const slices = getActiveSlices();
    if (slices.length === 0) {
      showToast('Activa al menos un participante', '#ef4444');
      return;
    }

    lastActivityPerf = performance.now();
    consecutiveIdlePrompts = 0;
    stopSpeech();

    isSpinning = true;
    $('btnCenterSpin').textContent = '...';

    const minSec = 3.0;
    const durationSec = minSec + Math.random() * Math.max(0.5, maxSpinSec - minSec);
    const targetIdx = selectFairSliceIndex(slices);
    const sliceArc = (Math.PI * 2) / slices.length;
    const jitter = 0.15 + Math.random() * 0.70;
    const desiredPointerAngle = (targetIdx + jitter) * sliceArc;

    const twoPi = Math.PI * 2;
    const desiredNorm = ((3 * Math.PI / 2 - desiredPointerAngle) % twoPi + twoPi) % twoPi;
    const curNorm = ((baseAngle % twoPi) + twoPi) % twoPi;
    const forwardDelta = ((desiredNorm - curNorm) % twoPi + twoPi) % twoPi;

    const totalTurns = Math.max(5, Math.round(durationSec * 1.45));
    currentSpinTargetAngle = baseAngle + totalTurns * twoPi + forwardDelta;

    if (soundPreset > 0 && SOUND_FILES[soundPreset]) {
      spinAudio.src = SOUND_FILES[soundPreset];
      spinAudio.currentTime = 0;
      spinAudio.play().catch(() => {});
    }

    const startPerf = performance.now();
    const totalMs = durationSec * 1000;
    const startAngle = baseAngle;

    function step(now) {
      const t = Math.min(1, (now - startPerf) / totalMs);
      const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
      currentAngle = startAngle + (currentSpinTargetAngle - startAngle) * ease;
      drawRouletteWheel();
      if (t < 1 && isSpinning) {
        spinRafId = requestAnimationFrame(step);
      } else if (isSpinning) {
        finishSpin(currentSpinTargetAngle);
      }
    }
    spinRafId = requestAnimationFrame(step);
  }

  function finishSpin(finalAngle) {
    if (spinRafId) cancelAnimationFrame(spinRafId);
    isSpinning = false;
    $('btnCenterSpin').textContent = 'GIRAR';
    try { spinAudio.pause(); spinAudio.currentTime = 0; } catch (_) {}

    const twoPi = Math.PI * 2;
    baseAngle = ((finalAngle % twoPi) + twoPi) % twoPi;
    currentAngle = baseAngle;
    drawRouletteWheel();

    const slices = getActiveSlices();
    if (slices.length === 0) return;
    const pointerAngle = (twoPi - baseAngle + 3 * Math.PI / 2) % twoPi;
    const idx = Math.floor(pointerAngle / (twoPi / slices.length)) % slices.length;
    winningSlice = slices[idx];

    lastWinningKey = winningSlice.key;
    lastSpinWasWildcard = winningSlice.isWildcard;
    participants.filter((p) => p.active).forEach((p) => {
      spinsSinceLastWin[p.id] = (spinsSinceLastWin[p.id] || 0) + 1;
    });

    if (!winningSlice.isWildcard) {
      const pid = winningSlice.participant.id;
      spinsSinceLastWin[pid] = 0;
      recentParticipantWinners.push(pid);
      if (recentParticipantWinners.length > 2) recentParticipantWinners.shift();
      suggestedNextSpinnerName = winningSlice.participant.name;
      $('lblTurnHint').textContent = `🖐️ Siguiente en girar: ${suggestedNextSpinnerName}`;
    }

    sfxVictory.currentTime = 0;
    sfxVictory.play().catch(() => {});

    if (isSoloSorteo) {
      currentChallenge = null;
      renderWinnerModal();
      return;
    }

    if (winningSlice.isWildcard) {
      currentChallenge = null;
      formattedChallengeText = winningSlice.description;
      renderWinnerModal();
      setTimeout(() => speakText(formattedChallengeText), 320);
    } else {
      prepareVipChallengeForWinner(winningSlice.participant);
      renderWinnerModal();
      setTimeout(() => speakText(formattedChallengeText), 380);
    }
  }

  // --- SORTEO DE RETO VIP 50/50 Y ADAPTADOR SEMÁNTICO ---
  function prepareVipChallengeForWinner(winner) {
    const enabledTags = [...(activeSession?.featuresEnabled || ['barra', 'mecato', 'instagram', 'social_vip'])];
    if (activeSession?.isPicanteVip && !enabledTags.includes('picante_vip')) {
      enabledTags.push('picante_vip');
    }

    const vipCatalog = (window.BY4K_VIP_CHALLENGES || []).filter(
      (c) => c.intensity <= partyIntensity && enabledTags.includes(c.tag)
    );
    const baseCatalog = (window.BY4K_BASE_VIP_MIX || []).filter(
      (c) => c.intensity <= partyIntensity
    );

    let pool = [];
    if (vipCatalog.length > 0 && baseCatalog.length > 0) {
      pool = Math.random() < 0.5 ? vipCatalog : baseCatalog;
    } else {
      pool = vipCatalog.length > 0 ? vipCatalog : baseCatalog;
    }

    let available = pool.filter((c) => !nonRepeatHistoryIds.has(c.id));
    if (available.length === 0) {
      nonRepeatHistoryIds.clear();
      available = pool;
    }
    const outsideCooldown = available.filter((c) => !cooldownChallengeIds.includes(c.id));
    if (outsideCooldown.length > 0) available = outsideCooldown;

    const chosen = available[Math.floor(Math.random() * available.length)] || {
      id: 'VIP-FALLBACK',
      text: '{jugador} levanta su vaso y brinda con toda la mesa en {bar_name}.',
      intensity: 1,
      category: 'Zona VIP B2B',
      tag: 'social_vip'
    };

    currentChallenge = chosen;
    nonRepeatHistoryIds.add(chosen.id);
    cooldownChallengeIds.push(chosen.id);
    if (cooldownChallengeIds.length > 5) cooldownChallengeIds.shift();

    const others = participants.filter((p) => p.active && p.id !== winner.id);
    const target = others.length > 0 ? others[Math.floor(Math.random() * others.length)] : null;
    const thirds = others.filter((p) => !target || p.id !== target.id);
    const judgeName = thirds.length > 0 ? thirds[Math.floor(Math.random() * thirds.length)].name : 'la mesa';

    formattedChallengeText = formatChallengeTokens(chosen.text, winner.name, target?.name, judgeName);

    // Acumular telemetría consolidada del bar
    tel.totalSpins++;
    tel.dSpins++;
    tel.lastText = formattedChallengeText;
    tel.lastCat = chosen.tag || chosen.category;
    tel.dirty = true;

    const low = formattedChallengeText.toLowerCase();
    if (
      chosen.tag === 'barra' ||
      chosen.tag === 'botellas_cubetazos' ||
      chosen.tag === 'mecato' ||
      low.includes('shot') ||
      low.includes('trago') ||
      low.includes('sorbo') ||
      low.includes('cerveza') ||
      low.includes('fondo')
    ) {
      const est = Math.max(1, Math.min(3, chosen.intensity || 1));
      tel.dConsChallenges++;
      tel.dDrinks += est;
      tel.totalDrinks += est;
    }

    if (tel.dSpins >= 5) {
      flushBarTelemetry('GIRO_BATCH_BAR', 'ACTIVA', formattedChallengeText);
    }
  }

  function formatChallengeTokens(raw, winnerName, targetName, judgeName) {
    let txt = raw
      .replace(/\{jugador\}/g, winnerName)
      .replace(/\{objetivo\}/g, targetName || 'alguien de la mesa');

    if (activeSession?.usePhysicalTokens) {
      txt = txt
        .replace(/\{rol_juez\}/g, 'el portador del Pin Rey de la Mesa')
        .replace(/\{accion_giro\}/g, 'El Rey de la Mesa presiona GIRAR')
        .replace(/\{mecanica_salvavidas\}/g, 'coloca tu Pin Escudo en el centro de la mesa o llama al mesero')
        .replace(/\{mecanica_desempate\}/g, 'lancen la Moneda 3D de la mesa (Bebes Tú / Bebe la Mesa)')
        .replace(/\{mecanica_veto\}/g, 'entreguen la Ficha de Veto al centro de la mesa')
        .replace(/\{mecanica_duelo\}/g, 'arroja la Ficha Duelo 1 vs 1 frente a tu rival')
        .replace(/\{mecanica_doble\}/g, 'coloca la Ficha de Ronda Doble en el centro (¡castigo duplicado!)');
    } else {
      txt = txt
        .replace(/\{rol_juez\}/g, judgeName || 'la mesa')
        .replace(/\{accion_giro\}/g, `${winnerName} presiona GIRAR`)
        .replace(/\{mecanica_salvavidas\}/g, 'pide un consumo al mesero y valida con su QR')
        .replace(/\{mecanica_desempate\}/g, 'jueguen piedra, papel o tijera a 1 tiro')
        .replace(/\{mecanica_veto\}/g, 'tomen 2 tragos de castigo para saltar el reto')
        .replace(/\{mecanica_duelo\}/g, 'señala a tu rival y desafíalo a duelo directo')
        .replace(/\{mecanica_doble\}/g, '¡Ronda Doble activada: se duplican los tragos del turno!');
    }

    const vars = activeSession?.variables || {};
    Object.keys(vars).forEach((k) => {
      if (vars[k]) txt = txt.split(`{${k}}`).join(vars[k]);
    });

    return txt
      .replace(/\{bar_name\}/g, activeSession?.barName || 'el bar')
      .replace(/\{shot_casa\}/g, 'un shot de la casa')
      .replace(/\{cerveza_premium\}/g, 'una cerveza premium')
      .replace(/\{cerveza_general\}/g, 'una cerveza')
      .replace(/\{juego_bar\}/g, 'el juego del bar')
      .replace(/\{mecato_bar\}/g, 'mecato o picada')
      .replace(/\{promo_noche\}/g, 'la promo de la noche')
      .replace(/\{ig_bar\}/g, '@elbar')
      .replace(/\{ig_app\}/g, '@By4K.app');
  }

  function hasChallengeTimer(text) {
    const l = (text || '').toLowerCase();
    return /segundo|30s|25s|20s|15s|10s|5s|3s|minuto/.test(l);
  }

  function detectSuggestedSeconds(text) {
    const l = (text || '').toLowerCase();
    if (l.includes('40 segundo')) return 40;
    if (l.includes('30 segundo') || l.includes('30s')) return 30;
    if (l.includes('25 segundo')) return 25;
    if (l.includes('20 segundo') || l.includes('20s')) return 20;
    if (l.includes('15 segundo') || l.includes('15s')) return 15;
    if (l.includes('5 segundo') || l.includes('5s')) return 5;
    return 10;
  }

  // --- MODAL DE GANADOR (MINIMALISTA EN SOLO SORTEO / COMPLETO EN CON RETOS) ---
  function renderWinnerModal() {
    clearInterval(challengeTimerInterval);
    const card = $('winnerModalCard');
    const modal = $('winnerModal');

    if (isSoloSorteo && winningSlice && !winningSlice.isWildcard) {
      const p = winningSlice.participant;
      const avStyle = p.photoDataUrl
        ? `background-image:url('${p.photoDataUrl}');border-color:${p.color};`
        : `background:${p.color};border-color:${p.color};`;
      card.style.borderColor = 'var(--cyan)';
      card.innerHTML = `
        <div style="text-align:center;padding:8px 0;">
          <div class="winner-avatar" style="${avStyle}">${p.photoDataUrl ? '' : getInitials(p.name)}</div>
          <div style="color:var(--cyan);font-size:13px;font-weight:900;letter-spacing:1.4px;margin-top:8px;">FUE ELEGIDO</div>
          <div style="font-size:28px;font-weight:900;margin:6px 0 22px;">${p.name}</div>
          <button class="btn-pink" type="button" onclick="dismissWinner(false)">Continuar</button>
        </div>
      `;
      modal.style.display = 'flex';
      return;
    }

    if (winningSlice.isWildcard) {
      card.style.borderColor = winningSlice.color;
      card.innerHTML = `
        <div style="text-align:center;">
          <div style="font-size:46px;">${winningSlice.icon}</div>
          <div style="font-size:20px;font-weight:900;color:${winningSlice.color};margin-top:4px;">${winningSlice.title.toUpperCase()}</div>
          <div class="challenge-box">${formattedChallengeText}</div>
          <button class="btn-gold" type="button" onclick="dismissWinner(false)">¡Entendido / Continuar!</button>
        </div>
      `;
      modal.style.display = 'flex';
      return;
    }

    const p = winningSlice.participant;
    const ch = currentChallenge;
    const avStyle = p.photoDataUrl
      ? `background-image:url('${p.photoDataUrl}');border-color:${p.color};width:62px;height:62px;margin:0;`
      : `background:${p.color};border-color:${p.color};width:62px;height:62px;margin:0;font-size:20px;`;

    challengeSecondsLeft = detectSuggestedSeconds(formattedChallengeText);
    const showTimer = hasChallengeTimer(formattedChallengeText);

    card.style.borderColor = 'var(--pink)';
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;justify-content:center;">
        <div class="winner-avatar" style="${avStyle}">${p.photoDataUrl ? '' : getInitials(p.name)}</div>
        <div>
          <div style="font-size:21px;font-weight:900;">${p.name}</div>
          <div style="display:inline-block;padding:2px 8px;border-radius:8px;background:rgba(255,215,0,0.16);border:1px solid rgba(255,215,0,0.6);color:var(--gold);font-size:11px;font-weight:800;margin-top:3px;">
            ${ch?.category || 'Zona VIP'} • ${'🍸'.repeat(ch?.intensity || 1)}
          </div>
        </div>
      </div>

      <div class="challenge-box">${formattedChallengeText}</div>

      ${showTimer ? `
        <div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:8px 12px;border-radius:12px;background:rgba(0,0,0,0.25);border:1px solid var(--border);margin-bottom:14px;">
          <span id="lblModalCountdown" style="font-family:monospace;font-size:18px;font-weight:900;">⏱️ ${challengeSecondsLeft}s</span>
          <button id="btnStartChallengeTimer" class="pill-btn active-retos" type="button" onclick="startModalCountdown()">▶ Iniciar Reloj</button>
        </div>
      ` : ''}

      <div style="display:flex;gap:8px;margin-bottom:9px;">
        ${p.swapsLeft > 0 ? `
          <button class="btn-outline" type="button" style="flex:1;padding:12px 8px;font-size:12.5px;" onclick="swapChallenge()">
            🔄 Cambiar (${p.swapsLeft})
          </button>
        ` : ''}
        <button class="btn-gold" type="button" style="flex:1.2;background:var(--green);padding:12px 8px;font-size:12.5px;" onclick="dismissWinner(true)">
          ✓ ¡Cumplido! (+${ch?.intensity || 1} 🍸)
        </button>
      </div>

      <button class="btn-outline" type="button" style="border-color:var(--green);color:var(--green);padding:10px;font-size:12.5px;" onclick="openSalvavidasWaiterScan()">
        📷 Salvar con Carné del Mesero
      </button>
    `;
    modal.style.display = 'flex';
  }

  window.startModalCountdown = function() {
    clearInterval(challengeTimerInterval);
    const lbl = $('lblModalCountdown');
    const btn = $('btnStartChallengeTimer');
    if (btn) btn.style.display = 'none';
    challengeTimerInterval = setInterval(() => {
      challengeSecondsLeft--;
      if (challengeSecondsLeft > 0) {
        if (lbl) lbl.textContent = `⏱️ ${challengeSecondsLeft}s`;
      } else {
        clearInterval(challengeTimerInterval);
        if (lbl) {
          lbl.textContent = '💥 ¡TIEMPO!';
          lbl.style.color = '#ff4455';
        }
        sfxBuzzer.currentTime = 0;
        sfxBuzzer.play().catch(() => {});
      }
    }, 1000);
  };

  window.swapChallenge = function() {
    if (!winningSlice || winningSlice.isWildcard) return;
    const p = winningSlice.participant;
    if (p.swapsLeft <= 0) return;
    p.swapsLeft--;
    stopSpeech();
    prepareVipChallengeForWinner(p);
    renderWinnerModal();
    speakText(formattedChallengeText);
  };

  window.dismissWinner = function(completed) {
    clearInterval(challengeTimerInterval);
    stopSpeech();
    lastActivityPerf = performance.now();
    if (winningSlice && !winningSlice.isWildcard) {
      if (completed && currentChallenge) {
        winningSlice.participant.drinks += currentChallenge.intensity || 1;
        winningSlice.participant.completed += 1;
      }
      if (isEliminationMode) {
        eliminatedIds.add(winningSlice.participant.id);
      }
    }
    winningSlice = null;
    currentChallenge = null;
    closeModal('winnerModal');
    syncTopAndBottomControlsUI();
    drawRouletteWheel();
  };

  window.openSalvavidasWaiterScan = function() {
    qrScannerMode = 'waiter_salvavidas';
    $('lblScannerTitle').textContent = '👔 Carné del Mesero (Salvavidas)';
    startQrScanner();
  };

  // --- FLUJO DE SALIDA VOLUNTARIA [ ✕ ]: VOZ @By4K.app + PODIO + CONFIRMACIÓN ---
  function openPodiumModal(isVipExitFlow) {
    const active = participants.filter((p) => p.active);
    const byComp = [...active].sort((a, b) => b.completed - a.completed);
    const byDrinks = [...active].sort((a, b) => b.drinks - a.drinks);
    const bySurv = [...active].sort((a, b) => a.drinks - b.drinks);

    const alma = byComp[0]?.completed > 0 ? byComp[0] : null;
    const tanque = byDrinks[0]?.drinks > 0 ? byDrinks[0] : null;
    const sobrev = active.length >= 2 ? bySurv[0] : null;

    const card = $('infoModalCard');
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h3 style="font-size:16.5px;font-weight:900;color:var(--gold);">
          🏆 ${isVipExitFlow ? 'PODIO DE LA NOCHE VIP' : 'HALL OF FAME'}
        </h3>
        <button class="icon-action" type="button" onclick="${isVipExitFlow ? 'confirmCloseVipDialog()' : "closeModal('infoModal')"}">✕</button>
      </div>
      ${isVipExitFlow ? `
        <div style="background:rgba(255,215,0,0.13);border:1px solid rgba(255,215,0,0.55);border-radius:11px;padding:8px 10px;font-size:11.5px;font-weight:700;text-align:center;color:#ffe57f;margin-bottom:10px;">
          🎯 Tip: Usa Solo Sorteo para rifar quién paga la cuenta • Síguenos en @By4K.app
        </div>
      ` : ''}
      <div class="podium-grid">
        <div class="podium-col">
          <div style="font-size:21px;">👑</div>
          <div style="font-size:10.5px;color:var(--gold);font-weight:800;">El Alma</div>
          <div style="font-size:12.5px;font-weight:900;margin-top:2px;">${alma ? alma.name : 'Pendiente'}</div>
          <div style="font-size:10px;color:var(--subtext);">${alma ? alma.completed : 0} retos</div>
        </div>
        <div class="podium-col">
          <div style="font-size:21px;">🍹</div>
          <div style="font-size:10.5px;color:var(--pink);font-weight:800;">El Tanque</div>
          <div style="font-size:12.5px;font-weight:900;margin-top:2px;">${tanque ? tanque.name : 'Pendiente'}</div>
          <div style="font-size:10px;color:var(--subtext);">${tanque ? tanque.drinks : 0} copas</div>
        </div>
        <div class="podium-col">
          <div style="font-size:21px;">🛡️</div>
          <div style="font-size:10.5px;color:var(--cyan);font-weight:800;">Sobreviviente</div>
          <div style="font-size:12.5px;font-weight:900;margin-top:2px;">${sobrev ? sobrev.name : 'Pendiente'}</div>
          <div style="font-size:10px;color:var(--subtext);">${sobrev ? sobrev.drinks : 0} copas</div>
        </div>
      </div>
      <div style="max-height:130px;overflow-y:auto;margin:12px 0;">
        ${active.map((p) => `
          <div style="display:flex;justify-content:space-between;padding:5px 2px;border-bottom:1px solid var(--border);font-size:12.5px;">
            <span style="font-weight:700;">${p.name}</span>
            <span style="font-family:monospace;color:var(--subtext);">🍸 ${p.drinks} | ✓ ${p.completed}</span>
          </div>
        `).join('')}
      </div>
      ${isVipExitFlow ? `
        <button class="btn-gold" type="button" onclick="confirmCloseVipDialog()">Continuar para cerrar Zona VIP ➔</button>
      ` : `
        <button class="btn-outline" type="button" onclick="resetNightScores()">🔄 Reiniciar Marcadores de la Noche</button>
      `}
    `;
    $('infoModal').style.display = 'flex';
  }

  window.resetNightScores = function() {
    participants.forEach((p) => { p.drinks = 0; p.completed = 0; p.swapsLeft = 2; });
    closeModal('infoModal');
    showToast('🎉 Marcadores reiniciados a cero');
  };

  window.confirmCloseVipDialog = function() {
    const card = $('infoModalCard');
    card.innerHTML = `
      <h3 style="font-size:17px;font-weight:900;color:#ff5566;margin-bottom:8px;">¿Cerrar Zona VIP?</h3>
      <p style="font-size:13.5px;color:var(--subtext);line-height:1.45;margin-bottom:18px;">
        Se purgarán los retos exclusivos de la casa y las fotos temporales de la sesión.
      </p>
      <div style="display:flex;gap:10px;">
        <button class="btn-outline" type="button" onclick="stopAndCancelCloseVip()">Cancelar</button>
        <button class="btn-pink" type="button" style="background:#ef4444;" onclick="executeVoluntaryCloseVip()">Cerrar Zona VIP</button>
      </div>
    `;
    $('infoModal').style.display = 'flex';
  };

  window.stopAndCancelCloseVip = function() {
    stopSpeech();
    closeModal('infoModal');
  };

  window.executeVoluntaryCloseVip = function() {
    stopSpeech();
    purgeVipSessionAndShowGate(true);
  };

  // --- ESCÁNER DE CÁMARA QR (BARCODEDETECTOR NATIVO + JSQR PARA SAFARI IPHONE) ---
  async function startQrScanner() {
    $('qrScannerModal').style.display = 'flex';
    const video = $('qrVideo');
    try {
      qrStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      video.srcObject = qrStream;
      await video.play();

      const nativeDetector = ('BarcodeDetector' in window)
        ? new window.BarcodeDetector({ formats: ['qr_code'] })
        : null;
      const canvas = $('qrHiddenCanvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const scanLoop = async () => {
        if (!qrStream) return;
        if (video.readyState >= 2) {
          let rawVal = null;
          if (nativeDetector) {
            try {
              const codes = await nativeDetector.detect(video);
              if (codes && codes.length > 0) rawVal = codes[0].rawValue;
            } catch (_) {}
          }
          if (!rawVal && window.jsQR) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = window.jsQR(imgData.data, imgData.width, imgData.height);
            if (code && code.data) rawVal = code.data;
          }
          if (rawVal) {
            await handleDecodedQrValue(rawVal);
            return;
          }
        }
        qrScanRaf = requestAnimationFrame(scanLoop);
      };
      qrScanRaf = requestAnimationFrame(scanLoop);
    } catch (_) {
      $('lblScannerHint').textContent = '⚠️ Cámara bloqueada por el navegador. Usa "🖼️ Leer desde Foto" abajo o ingresa la llave manual.';
    }
  }

  window.stopQrScanner = function() {
    if (qrScanRaf) cancelAnimationFrame(qrScanRaf);
    qrScanRaf = null;
    if (qrStream) {
      qrStream.getTracks().forEach((t) => t.stop());
      qrStream = null;
    }
    qrTorchOn = false;
    closeModal('qrScannerModal');
  };

  async function handleDecodedQrValue(rawVal) {
    stopQrScanner();
    if (qrScannerMode === 'bar') {
      const useTokens = $('chkGateTokens').checked;
      const res = await processRawVipPayload(rawVal, useTokens);
      if (!res.ok) {
        $('gateError').textContent = res.error;
        $('gateError').style.display = 'block';
      } else {
        $('gateError').style.display = 'none';
      }
    } else {
      const ok = await verifyWaiterQr(rawVal);
      if (!ok) {
        showToast('❌ Carné de mesero no reconocido para este bar', '#ef4444');
        return;
      }
      tel.totalWaiterCalls++;
      tel.dWaiter++;
      if (qrScannerMode === 'waiter_picante') {
        activeSession.isPicanteVip = true;
        localStorage.setItem(LS_SESSION, JSON.stringify(activeSession));
        flushBarTelemetry('LLAMADA_MESERO', 'ACTIVA', 'Activación Picante VIP en PWA');
        syncTopAndBottomControlsUI();
        showToast('🌶️ ¡Picante VIP activado con carné del mesero!', '#ff007f');
      } else if (qrScannerMode === 'waiter_salvavidas') {
        flushBarTelemetry('LLAMADA_MESERO', 'ACTIVA', 'Salvavidas de reto validado por mesero');
        sfxVictory.play().catch(() => {});
        showToast('👑 ¡Reto perdonado por el mesero! Siguiente turno libre.');
        window.dismissWinner(false);
      }
    }
  }

  // --- PARTICIPANTES Y BURBUJAS FLOTANTES ---
  function compressImageToDataUrl(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          const sz = 140;
          c.width = sz;
          c.height = sz;
          const g = c.getContext('2d');
          const minSide = Math.min(img.width, img.height);
          const sx = (img.width - minSide) / 2;
          const sy = (img.height - minSide) / 2;
          g.drawImage(img, sx, sy, minSide, minSide, 0, 0, sz, sz);
          resolve(c.toDataURL('image/jpeg', 0.72));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function renderPlayersList() {
    const box = $('playersListContainer');
    box.innerHTML = participants.map((p, idx) => {
      const dotStyle = p.photoDataUrl
        ? `background-image:url('${p.photoDataUrl}');`
        : `background:${p.color};`;
      return `
        <div class="player-item">
          <div class="player-dot" style="${dotStyle}">${p.photoDataUrl ? '' : getInitials(p.name)}</div>
          <div style="flex:1;font-weight:700;font-size:13.5px;opacity:${p.active ? 1 : 0.45};">${p.name}</div>
          <input type="checkbox" ${p.active ? 'checked' : ''} onchange="togglePlayerActive(${idx})" style="width:18px;height:18px;accent-color:var(--cyan);">
          <button class="icon-action" type="button" style="color:#ff5566;font-size:15px;" onclick="removePlayer(${idx})">🗑️</button>
        </div>
      `;
    }).join('');
  }

  window.togglePlayerActive = function(idx) {
    participants[idx].active = !participants[idx].active;
    renderPlayersList();
    renderFloatingBubbles();
    syncTopAndBottomControlsUI();
    drawRouletteWheel();
  };

  window.removePlayer = function(idx) {
    if (participants.length <= 2) {
      showToast('Mínimo 2 participantes en la mesa', '#ef4444');
      return;
    }
    participants.splice(idx, 1);
    renderPlayersList();
    renderFloatingBubbles();
    syncTopAndBottomControlsUI();
    drawRouletteWheel();
  };

  function renderFloatingBubbles() {
    const layer = $('bubblesLayer');
    if (!layer) return;
    const active = participants.filter((p) => p.active);
    layer.innerHTML = active.map((p, i) => {
      const style = p.photoDataUrl
        ? `background-image:url('${p.photoDataUrl}');color:${p.color};`
        : `background:${p.color};color:${p.color};`;
      return `<div class="floating-bubble" data-bidx="${i}" style="${style}">${p.photoDataUrl ? '' : `<span style="color:#fff;">${getInitials(p.name)}</span>`}</div>`;
    }).join('');
  }

  function animateFloatingBubbles(now) {
    if (activeSession) {
      const t = now * 0.00042;
      const nodes = document.querySelectorAll('.floating-bubble');
      const w = window.innerWidth;
      const h = window.innerHeight;
      nodes.forEach((el, i) => {
        const phase = i * 1.15;
        const u = 0.5 + 0.39 * Math.sin(t + phase);
        const v = 0.52 + 0.36 * Math.cos(1.6 * t + phase);
        const x = Math.max(8, Math.min(w - 60, u * w - 26));
        const y = Math.max(70, Math.min(h - 70, v * h - 26));
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      });
    }
    requestAnimationFrame(animateFloatingBubbles);
  }

  // --- SINCRONIZACIÓN DE CONTROLES E INTERFAZ UNIFICADA ---
  function syncTopAndBottomControlsUI() {
    const btnMode = $('btnToggleMode');
    btnMode.textContent = isSoloSorteo ? '🎯 Solo Sorteo ⇄' : '🎲 Con Retos ⇄';
    btnMode.className = `pill-btn ${isSoloSorteo ? 'active-sorteo' : 'active-retos'}`;

    $('topActionsRetos').style.display = isSoloSorteo ? 'none' : 'flex';
    $('intensityBar').style.display = isSoloSorteo ? 'none' : 'flex';
    $('btnPicanteVipPill').style.display = isSoloSorteo ? 'none' : 'inline-flex';
    $('wildcardsSettingsBlock').style.display = isSoloSorteo ? 'none' : 'block';

    const themeMap = { neon: '🎉 Neón', day: '☀️ Día', night: '🌙 Noche' };
    $('btnCycleTheme').textContent = themeMap[visualTheme];
    document.body.classList.toggle('theme-day', visualTheme === 'day');
    document.body.classList.toggle('theme-night', visualTheme === 'night');

    if (activeSession) {
      $('btnBannerTokens').textContent = activeSession.usePhysicalTokens ? '🎖️ Fichas: ON' : '📱 Virtual';
      const bdgPic = $('bdgPicanteVip');
      bdgPic.textContent = activeSession.isPicanteVip ? 'ON' : 'OFF';
      bdgPic.className = `status-badge ${activeSession.isPicanteVip ? 'on' : ''}`;
    }

    const activeCount = participants.filter((p) => p.active).length;
    const remCount = participants.filter((p) => p.active && !eliminatedIds.has(p.id)).length;
    const bdgElim = $('bdgElim');
    bdgElim.textContent = isEliminationMode ? `ON (${remCount}/${activeCount})` : 'OFF';
    bdgElim.className = `status-badge ${isEliminationMode ? 'on' : ''}`;

    $('btnParticipants').textContent = `👥 Participantes (${isEliminationMode ? remCount : activeCount})`;

    document.querySelectorAll('#intensityBar .int-item').forEach((el) => {
      const lv = Number(el.dataset.level);
      el.classList.toggle('selected', lv === partyIntensity);
    });
  }

  // --- BOTÓN DE INSTALACIÓN PWA (ANDROID NATIVO + GUÍA VISUAL IPHONE SAFARI) ---
  function isAppInstalledStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function updateInstallButtonsState() {
    const installed = isAppInstalledStandalone();
    ['btnInstallGate', 'btnInstallTop'].forEach((id) => {
      const b = $(id);
      if (!b) return;
      b.textContent = installed ? '✓ Instalada' : '📲 Instalar';
    });
  }

  async function handleInstallPwaClick() {
    if (isAppInstalledStandalone()) {
      showToast('✓ Ruleta By4K VIP ya está instalada en tu inicio');
      return;
    }

    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        deferredInstallPrompt = null;
        updateInstallButtonsState();
      }
      return;
    }

    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const body = $('installGuideBody');

    if (isIOS) {
      body.innerHTML = `
        <p style="margin-bottom:10px;">Instala el acceso directo oficial de <strong>Ruleta By4K VIP</strong> en tu iPhone en 2 toques:</p>
        <div class="plan-mini"><strong>1.</strong> Toca el botón <strong>Compartir</strong> <span style="color:var(--cyan);font-weight:900;">[ ↑ ]</span> en la barra inferior de Safari.</div>
        <div class="plan-mini"><strong>2.</strong> Desliza hacia abajo y selecciona <strong>"Agregar a pantalla de inicio" (➕)</strong>.</div>
        <div class="plan-mini"><strong>3.</strong> Pulsa <strong>"Agregar"</strong> arriba a la derecha ¡y listo!</div>
      `;
    } else {
      body.innerHTML = `
        <p style="margin-bottom:10px;">Para dejar <strong>Ruleta By4K VIP</strong> en la pantalla principal de tu celular:</p>
        <div class="plan-mini"><strong>1.</strong> Toca el menú de 3 puntos <strong>(⋮)</strong> arriba a la derecha en Chrome.</div>
        <div class="plan-mini"><strong>2.</strong> Elige <strong>"Instalar aplicación"</strong> o <strong>"Agregar a la pantalla principal"</strong>.</div>
        <p style="font-size:11.5px;color:var(--subtext);margin-top:8px;">💡 ¿Quieres la App completa con 185 retos para casa y 4 voces? Descárgala en Google Play.</p>
      `;
    }
    $('installGuideModal').style.display = 'flex';
  }

  // --- RELOJ MAESTRO DE 1 SEGUNDO: CONTEO REGRESIVO, BARAJAR (5m/10m) E INACTIVIDAD (3m) ---
  function startMasterTicker() {
    setInterval(() => {
      persistLastTrueEpoch();
      if (!activeSession) return;

      const remMs = getRemainingSessionMs();
      if (remMs <= 0) {
        // EXPIRACIÓN EXACTA 00:00: Bloqueo directo sin podio y pantalla de conversión
        purgeVipSessionAndShowGate(true);
        return;
      }

      const totalSec = Math.floor(remMs / 1000);
      const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0');
      const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
      const ss = String(totalSec % 60).padStart(2, '0');
      $('lblRemainingTimer').textContent = `⏳ ${hh}:${mm}:${ss} restantes`;

      const nowP = performance.now();
      const sessionMins = (nowP - sessionActivatedPerf) / 60000;
      const shuffleMins = (nowP - lastShufflePerf) / 60000;
      const shuffleVoiceMins = (nowP - lastShuffleVoicePerf) / 60000;
      const idleMins = (nowP - lastActivityPerf) / 60000;

      // Sugerencias de intensidad a los 10 y 20 minutos
      $('intLevel2').classList.toggle('sweep-green', !isSoloSorteo && sessionMins >= 10 && sessionMins < 20 && partyIntensity === 1);
      $('intLevel3').classList.toggle('sweep-green', !isSoloSorteo && sessionMins >= 20 && partyIntensity <= 2);

      // Sugerencia visual verde en Barajar a los 5 minutos
      $('btnShuffle').classList.toggle('sweep-green', shuffleMins >= 5);

      // Latido periódico de telemetría cada 2 minutos si hay cambios pendientes
      if (tel.dirty && Math.floor(totalSec) % 120 === 0) {
        flushBarTelemetry('UPDATE_DIARIO_BAR', 'ACTIVA', 'Consolidado periódico PWA');
      }

      // Avisos por voz (sin interrumpir giros ni modales abiertos)
      const anyModalOpen = ['winnerModal', 'participantsModal', 'settingsModal', 'infoModal', 'qrScannerModal']
        .some((id) => $(id).style.display === 'flex');

      if (!isSpinning && !anyModalOpen && !isSpeaking && consecutiveIdlePrompts < 3) {
        if (shuffleMins >= 10 && shuffleVoiceMins >= 10) {
          lastShuffleVoicePerf = nowP;
          lastActivityPerf = nowP;
          consecutiveIdlePrompts++;
          speakText('Si quieres incrementar la aleatoriedad, puedes usar la opción barajar.');
        } else if (idleMins >= 3) {
          lastActivityPerf = nowP;
          consecutiveIdlePrompts++;
          const phrases = [
            '¿Quién sigue? No dejen enfriar la noche, gira la ruleta.',
            'Si quieres incrementar la aleatoriedad, puedes usar la opción barajar.',
            'La ruleta VIP está esperando al siguiente valiente. ¡Toca girar!'
          ];
          speakText(phrases[idleRotationIdx % phrases.length]);
          idleRotationIdx++;
        }
      }
    }, 1000);
  }

  // --- ENLACE DE EVENTOS DE INTERFAZ ---
  function bindEvents() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      updateInstallButtonsState();
    });

    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      updateInstallButtonsState();
      showToast('🎉 ¡Ruleta By4K VIP instalada en tu pantalla de inicio!');
    });

    window.addEventListener('resize', resizeWheelCanvas);

    // Detectar navegador interno de Instagram / WhatsApp / TikTok
    if (/Instagram|FBAN|FBAV|WhatsApp|BytedanceWebview|Musical\.ly/i.test(navigator.userAgent || '')) {
      $('inAppBrowserBanner').style.display = 'block';
    }

    $('btnInstallGate').addEventListener('click', handleInstallPwaClick);
    $('btnInstallTop').addEventListener('click', handleInstallPwaClick);

    $('chkGateTokens').addEventListener('change', (e) => {
      $('gateTokensSub').textContent = e.target.checked
        ? 'Pin Rey, Escudo, Moneda 3D y Ficha de Veto'
        : 'Modo 100% digital en pantalla';
    });

    $('btnScanBarQr').addEventListener('click', () => {
      qrScannerMode = 'bar';
      $('lblScannerTitle').textContent = '📷 Escanear QR de Mesa VIP';
      startQrScanner();
    });

    $('btnValidateCode').addEventListener('click', async () => {
      const code = $('inpBackupCode').value;
      const res = await processRawVipPayload(code, $('chkGateTokens').checked);
      if (!res.ok) {
        $('gateError').textContent = res.error;
        $('gateError').style.display = 'block';
      } else {
        $('gateError').style.display = 'none';
      }
    });

    $('btnPlayStoreConversion').addEventListener('click', () => {
      postTelemetry({
        action: 'CLICK_DESCARGA_PWA',
        fechaOperativa: computeOperationalDate(trueNowMs()),
        plataforma: 'PWA_Web'
      });
    });

    $('btnToggleMode').addEventListener('click', () => {
      lastActivityPerf = performance.now();
      isSoloSorteo = !isSoloSorteo;
      syncTopAndBottomControlsUI();
      drawRouletteWheel();
    });

    $('btnCycleTheme').addEventListener('click', () => {
      visualTheme = visualTheme === 'neon' ? 'day' : (visualTheme === 'day' ? 'night' : 'neon');
      syncTopAndBottomControlsUI();
      drawRouletteWheel();
    });

    $('btnOpenPodium').addEventListener('click', () => openPodiumModal(false));

    $('btnOpenLegal').addEventListener('click', () => {
      $('infoModalCard').innerHTML = `
        <h3 style="font-size:17px;font-weight:900;color:var(--gold);margin-bottom:8px;">🔞 Consumo Responsable</h3>
        <p style="font-size:12.5px;line-height:1.5;color:var(--subtext);margin-bottom:14px;">
          • Exclusivo para mayores de 18 años.<br>
          • El exceso de alcohol es perjudicial para la salud (Ley 30 de 1986).<br>
          • Prohíbase el expendio de bebidas embriagantes a menores de edad (Ley 124 de 1994).<br>
          • Todos los retos son voluntarios y pueden jugarse con bebidas sin alcohol.<br>
          • Si tomas, entrega las llaves.
        </p>
        <button class="btn-gold" type="button" onclick="closeModal('infoModal')">Entendido</button>
      `;
      $('infoModal').style.display = 'flex';
    });

    $('btnOpenTokensGuide').addEventListener('click', () => {
      $('infoModalCard').innerHTML = `
        <h3 style="font-size:17px;font-weight:900;color:var(--gold);margin-bottom:8px;">🎖️ Fichas Físicas en Mesa</h3>
        <p style="font-size:12.5px;line-height:1.5;color:var(--subtext);margin-bottom:14px;">
          Si tu mesa tiene el kit físico del bar deja <strong>Fichas: ON</strong> (Pin Rey, Pin Escudo, Moneda 3D y Ficha Duelo). Si juegan solo con el celular, cámbialo a <strong>📱 Virtual</strong> en el banner superior.
        </p>
        <button class="btn-gold" type="button" onclick="closeModal('infoModal')">¡Listo!</button>
      `;
      $('infoModal').style.display = 'flex';
    });

    $('btnBannerTokens').addEventListener('click', () => {
      if (!activeSession) return;
      activeSession.usePhysicalTokens = !activeSession.usePhysicalTokens;
      localStorage.setItem(LS_SESSION, JSON.stringify(activeSession));
      syncTopAndBottomControlsUI();
    });

    // Salida voluntaria [ ✕ ]: Dispara voz @By4K.app + Podio + Confirmación
    $('btnVipExitX').addEventListener('click', () => {
      lastActivityPerf = performance.now();
      speakText('¡Gran noche! Pasa a Solo Sorteo para rifar quién paga la cuenta. Desbloquea el Pase 48 horas o el Modo PRO en nuestra app, y síguenos en arroba By4K punto app.');
      openPodiumModal(true);
    });

    document.querySelectorAll('#intensityBar .int-item').forEach((el) => {
      el.addEventListener('click', () => {
        partyIntensity = Number(el.dataset.level) || 1;
        syncTopAndBottomControlsUI();
      });
    });

    $('btnCenterSpin').addEventListener('click', triggerSpin);
    $('wheelCanvas').addEventListener('click', () => {
      if (isSpinning) {
        finishSpin(currentSpinTargetAngle);
      } else {
        triggerSpin();
      }
    });

    $('btnEliminationPill').addEventListener('click', () => {
      isEliminationMode = !isEliminationMode;
      eliminatedIds.clear();
      syncTopAndBottomControlsUI();
      drawRouletteWheel();
    });

    $('btnPicanteVipPill').addEventListener('click', () => {
      if (!activeSession) return;
      if (activeSession.isPicanteVip) {
        activeSession.isPicanteVip = false;
        localStorage.setItem(LS_SESSION, JSON.stringify(activeSession));
        syncTopAndBottomControlsUI();
        showToast('🌶️ Modo Picante VIP desactivado');
      } else {
        qrScannerMode = 'waiter_picante';
        $('lblScannerTitle').textContent = '🌶️ Carné del Mesero (Activar Picante VIP)';
        startQrScanner();
      }
    });

    $('btnShuffle').addEventListener('click', () => {
      if (isSpinning) return;
      for (let i = participants.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [participants[i], participants[j]] = [participants[j], participants[i]];
      }
      lastShufflePerf = performance.now();
      lastShuffleVoicePerf = performance.now();
      lastActivityPerf = performance.now();
      consecutiveIdlePrompts = 0;
      $('btnShuffle').classList.remove('sweep-green');
      renderFloatingBubbles();
      drawRouletteWheel();
      showToast('🔀 Participantes barajados');
    });

    $('btnParticipants').addEventListener('click', () => {
      renderPlayersList();
      $('participantsModal').style.display = 'flex';
    });

    $('inpNewPlayerPhoto').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) {
        pendingNewPhotoDataUrl = await compressImageToDataUrl(f);
        $('lblPendingPhoto').style.display = 'block';
      }
    });

    $('btnAddPlayer').addEventListener('click', () => {
      const nm = ($('inpNewPlayerName').value || '').trim();
      if (!nm) return;
      participants.push({
        id: 'p_' + Date.now(),
        name: nm,
        color: PLAYER_COLORS[participants.length % PLAYER_COLORS.length],
        active: true,
        photoDataUrl: pendingNewPhotoDataUrl,
        drinks: 0,
        completed: 0,
        swapsLeft: 2
      });
      $('inpNewPlayerName').value = '';
      pendingNewPhotoDataUrl = null;
      $('lblPendingPhoto').style.display = 'none';
      renderPlayersList();
      renderFloatingBubbles();
      syncTopAndBottomControlsUI();
      drawRouletteWheel();
    });

    $('btnSettings').addEventListener('click', () => {
      $('settingsModal').style.display = 'flex';
    });

    $('selSoundPreset').addEventListener('change', (e) => {
      soundPreset = Number(e.target.value) || 0;
      if (soundPreset > 0 && SOUND_FILES[soundPreset]) {
        const prev = new Audio(SOUND_FILES[soundPreset]);
        prev.play().catch(() => {});
        setTimeout(() => { try { prev.pause(); } catch (_) {} }, 1800);
      }
    });

    $('rngSpinSec').addEventListener('input', (e) => {
      maxSpinSec = Number(e.target.value) || 7;
      $('lblSpinMaxSec').textContent = `${maxSpinSec}s`;
    });

    $('chkBombWildcard').addEventListener('change', (e) => {
      useBombWildcard = e.target.checked;
      drawRouletteWheel();
    });

    $('chkDictatorWildcard').addEventListener('change', (e) => {
      useDictatorWildcard = e.target.checked;
      drawRouletteWheel();
    });

    $('btnToggleTorch').addEventListener('click', async () => {
      if (!qrStream) return;
      const track = qrStream.getVideoTracks()[0];
      if (!track) return;
      try {
        qrTorchOn = !qrTorchOn;
        await track.applyConstraints({ advanced: [{ torch: qrTorchOn }] });
      } catch (_) {
        showToast('Linterna no disponible en este navegador', '#ef4444');
      }
    });

    $('inpQrImageFallback').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f || !window.jsQR) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const c = $('qrHiddenCanvas');
          c.width = img.width;
          c.height = img.height;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height);
          const code = window.jsQR(d.data, d.width, d.height);
          if (code && code.data) {
            handleDecodedQrValue(code.data);
          } else {
            showToast('❌ No se detectó un código QR claro en la foto', '#ef4444');
          }
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(f);
    });
  }

  // --- INICIALIZACIÓN ---
  async function bootstrap() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    bindEvents();
    updateInstallButtonsState();
    requestAnimationFrame(animateFloatingBubbles);
    startMasterTicker();

    await fetchServerClockAndBars();

    // 1. Si llega por URL directa desde cámara nativa (?qr=... o ?code=...)
    const params = new URLSearchParams(window.location.search);
    const urlPayload = params.get('qr') || params.get('p') || params.get('code');
    const wantInstall = params.get('install') === '1';

    if (urlPayload) {
      window.history.replaceState({}, document.title, window.location.pathname);
      const res = await processRawVipPayload(urlPayload, true);
      if (res.ok) return;
    }

    // 2. Restaurar sesión VIP vigente si existe y pasa el Triple Candado
    try {
      const saved = JSON.parse(localStorage.getItem(LS_SESSION) || 'null');
      if (saved && saved.expiresAtMs) {
        if (hasClockRollbackDetected() || trueNowMs() >= saved.expiresAtMs) {
          localStorage.removeItem(LS_SESSION);
          purgeVipSessionAndShowGate(true);
        } else {
          activeSession = saved;
          activeSession.isPicanteVip = false; // Picante VIP siempre inicia OFF al reabrir
          monoStartPerf = performance.now();
          monoInitialRemainingMs = saved.expiresAtMs - trueNowMs();
          enterVipStageUI();
        }
      }
    } catch (_) {}

    if (wantInstall) {
      setTimeout(handleInstallPwaClick, 450);
    }
  }

  bootstrap();
})();
