// iTag Score — marcador con botones Bluetooth iTag (Web · Android · iOS)
// Todo el código de la app vive en este archivo.
import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { BleClient, numberToUUID, numbersToDataView } from '@capacitor-community/bluetooth-le'
import { VolumeButtons } from '@capacitor-community/volume-buttons'
import './App.css'

/* ═════════════════════════ SUPABASE ═════════════════════════ */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://aswuqsenfjgwqsesethe.supabase.co'
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzd3Vxc2VuZmpnd3FzZXNldGhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMDI1NTQsImV4cCI6MjEwMzc3ODU1NH0.cZCMLIsLAEXwOsbXS7wpfnI7xb-kqK-sduHPjrCndbQ'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const DEMO = import.meta.env.DEV // pantallas de prueba (#demo-match, #demo-setup) solo en desarrollo

/* ═════════════════════════ MARCADOR (lógica pura) ═════════════════════════ */
const TENNIS = ['0', '15', '30', '40']

// Configuración de un partido (se guarda dentro del estado del partido: no requiere columnas nuevas)
const DEFAULT_CFG = {
  sport: 'padel', // padel | tennis | points
  scoring: 'classic', // classic = 15-30-40 · numeric = 1-2-3
  golden: true, // punto de oro en 40-40 (pádel)
  gamesPerSet: 6,
  setsToWin: 2, // 1 = a un set · 2 = al mejor de 3 · 3 = al mejor de 5 · 0 = sin límite
  tiebreak: true,
  target: 11, // puntos por set en modo "por puntos"
  minutes: 0, // tiempo de juego, 0 = sin límite
  applause: true, // aplausos en cada punto
  voiceName: true, // la voz dice quién anotó
  voiceScore: true, // la voz canta el marcador
}
const isPoints = (cfg) => cfg.sport === 'points'

// Partidos creados antes de la configuración nueva
const legacyCfg = (m) => ({
  ...DEFAULT_CFG, sport: m?.mode === 'points' ? 'points' : 'tennis', golden: false, setsToWin: 0,
  target: m?.target ?? 11, applause: false, voiceName: false,
})

const newGame = (cfg = DEFAULT_CFG, server = 0) => ({
  cfg, points: [0, 0], games: [0, 0], sets: [0, 0], setLog: [], server, last: null, tiebreak: false,
  winner: null, evt: null, clock: { start: null, pausedAt: null, paused: 0 }, v: 0,
})

function closeSet(g, p, finalScore, cfg) {
  const sets = [...g.sets]
  sets[p]++
  const winner = cfg.setsToWin > 0 && sets[p] >= cfg.setsToWin ? p : null
  return { ...g, sets, setLog: [...g.setLog, finalScore], points: [0, 0], games: [0, 0], tiebreak: false, winner }
}

function addPoint(g, p, cfg) {
  if (g.winner !== null && g.winner !== undefined) return g
  const o = 1 - p
  const pts = [...g.points]
  pts[p]++
  let n = { ...g, points: pts, last: p }

  if (isPoints(cfg)) {
    const t = cfg.target
    const deuce = pts[0] >= t - 1 && pts[1] >= t - 1
    if (deuce || (pts[0] + pts[1]) % 2 === 0) n.server = 1 - g.server
    if (pts[p] >= t && pts[p] - pts[o] >= 2) n = closeSet(n, p, pts, cfg)
    return n
  }

  if (g.tiebreak) {
    if ((pts[0] + pts[1]) % 2 === 1) n.server = 1 - g.server
    if (pts[p] >= 7 && pts[p] - pts[o] >= 2) {
      const games = [...g.games]
      games[p]++
      n = closeSet({ ...n, server: 1 - g.server }, p, games, cfg)
    }
    return n
  }

  // Gana el juego con 4 puntos y 2 de diferencia, o con punto de oro en 40-40
  if (pts[p] >= 4 && (pts[p] - pts[o] >= 2 || (cfg.golden && pts[o] >= 3))) {
    const games = [...g.games]
    games[p]++
    const gps = cfg.gamesPerSet
    n = { ...n, games, points: [0, 0], server: 1 - g.server }
    if (games[p] >= gps && (games[p] - games[o] >= 2 || (cfg.tiebreak && games[p] === gps + 1))) {
      n = closeSet(n, p, games, cfg)
    } else if (cfg.tiebreak && games[0] === gps && games[1] === gps) n.tiebreak = true
  }
  return n
}

function labels(g, cfg) {
  if (isPoints(cfg) || g.tiebreak)
    return { a: [String(g.points[0]), String(g.points[1])], note: g.tiebreak ? 'TIE-BREAK' : '' }
  const [a, b] = g.points
  const num = cfg.scoring === 'numeric'
  if (a >= 3 && b >= 3) {
    if (a === b) return { a: num ? [String(a), String(b)] : ['40', '40'], note: cfg.golden ? 'PUNTO DE ORO' : 'IGUALES' }
    return { a: num ? [String(a), String(b)] : a > b ? ['AD', '40'] : ['40', 'AD'], note: 'VENTAJA' }
  }
  return { a: num ? [String(a), String(b)] : [TENNIS[a], TENNIS[b]], note: '' }
}

function winnerSlot(g) {
  if (g.winner === 0 || g.winner === 1) return g.winner
  for (const k of ['sets', 'games', 'points']) {
    if (g[k][0] !== g[k][1]) return g[k][0] > g[k][1] ? 0 : 1
  }
  return null
}

const SAY = { 0: 'cero', 15: 'quince', 30: 'treinta', 40: 'cuarenta' }
function announceText(g, cfg, names) {
  const { a, note } = labels(g, cfg)
  if (note === 'IGUALES') return 'Iguales'
  if (note === 'PUNTO DE ORO') return 'Punto de oro'
  if (note === 'VENTAJA') return `Ventaja ${names[g.points[0] > g.points[1] ? 0 : 1]}`
  if (g.points[0] === 0 && g.points[1] === 0 && g.last !== null) {
    const unit = isPoints(cfg) ? 'Sets' : 'Juegos'
    const v = isPoints(cfg) ? g.sets : g.games
    return `${unit}: ${names[0]} ${v[0]}, ${names[1]} ${v[1]}`
  }
  const s = g.server
  return `${SAY[a[s]] ?? a[s]}, ${SAY[a[1 - s]] ?? a[1 - s]}`
}

// Reloj del partido (se pausa y se sincroniza con el resto del estado)
const clockElapsed = (c, now = Date.now()) => (c?.start ? (c.pausedAt ?? now) - c.start - (c.paused ?? 0) : 0)
const fmtClock = (ms) => {
  const t = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`
}
function toggleClock(c, now) {
  if (!c.start) return { start: now, pausedAt: null, paused: 0 }
  if (c.pausedAt) return { ...c, pausedAt: null, paused: c.paused + (now - c.pausedAt) }
  return { ...c, pausedAt: now }
}

// Estado + historial para deshacer. El reloj no retrocede al deshacer.
const pushState = (s, game) => ({ game, past: [...s.past.slice(-200), s.game] })
function scoreReducer(s, a) {
  const g = s.game
  const evt = (type, p) => ({ type, p, id: a.v })
  switch (a.type) {
    case 'point': {
      if (g.winner !== null && g.winner !== undefined) return s
      const clock = g.clock?.start ? g.clock : { start: a.v, pausedAt: null, paused: 0 } // arranca con el 1er punto
      return pushState(s, { ...addPoint(g, a.p, a.cfg), clock, evt: evt('point', a.p), v: a.v })
    }
    case 'undo':
      return s.past.length
        ? { game: { ...s.past.at(-1), clock: g.clock, evt: evt('undo', a.p), v: a.v }, past: s.past.slice(0, -1) }
        : s
    case 'reset': return pushState(s, { ...newGame(a.cfg, g.server), clock: g.clock, evt: evt('reset', a.p), v: a.v })
    case 'server': return pushState(s, { ...g, server: 1 - g.server, evt: null, v: a.v })
    case 'clock': return { ...s, game: { ...g, clock: toggleClock(g.clock ?? {}, a.v), evt: null, v: a.v } }
    case 'remote':
      if ((a.game?.v ?? 0) <= (g.v ?? 0)) return s
      return { game: a.game, past: a.past ?? s.past }
    default: return s
  }
}

/* ═════════════════════════ PULSACIONES (1 = punto, 2 = deshacer, 3 / mantener = borrar) ═════════════════════════ */
function makeClickDecoder(onAction, wait = 380) {
  let n = 0, t
  return () => {
    n++
    clearTimeout(t)
    t = setTimeout(() => {
      const c = n
      n = 0
      onAction(c === 1 ? 'point' : c === 2 ? 'undo' : 'reset')
    }, wait)
  }
}

/* ═════════════════════════ BOTONES: iTAG · RASTREADORES BLE · BOTONES SELFIE ═════════════════════════ */
const ITAG_BTN = numberToUUID(0xffe1)
const ALERT_SVC = numberToUUID(0x1802)
const LINK_LOSS_SVC = numberToUUID(0x1803)
const ALERT_LEVEL = numberToUUID(0x2a06)
const HOLD_MS = 900

// Servicios donde los iTag y los rastreadores "anti-pérdida" genéricos avisan cuando se pulsa su botón.
// En la web hay que declararlos todos de antemano: el navegador no deja leer los que no estén en la lista.
const BUTTON_SERVICES = [0xffe0, 0xfff0, 0xffa0, 0xffb0, 0xffc0, 0xffd0, 0xff00, 0xfee0, 0xfee7, 0x1802, 0x1803, 0x1804]
  .map(numberToUUID)
// Avisos que no son pulsaciones (batería, cambios de servicio, nombre…)
const NOT_BUTTONS = new Set([0x2a19, 0x2a05, 0x2a00, 0x2a01, 0x2a04].map(numberToUUID))

const isNative = Capacitor.isNativePlatform()
const bleSupported = isNative || (typeof navigator !== 'undefined' && !!navigator.bluetooth)

// Almacén global: los dispositivos siguen conectados aunque cambies de pantalla
const itags = {
  slots: [null, null], // { deviceId, name, status }
  handlers: [null, null], // (kind: 'click' | 'hold') => void
  listeners: new Set(),
  set(slot, val) {
    this.slots = this.slots.map((s, i) => (i === slot ? val : s))
    this.listeners.forEach((l) => l())
  },
  subscribe(l) { itags.listeners.add(l); return () => itags.listeners.delete(l) },
  snapshot() { return itags.slots },
}
let bleInit
const ensureBle = () => (bleInit ??= BleClient.initialize({ androidNeverForLocation: true }))

// Convierte los avisos de un botón en 'click' / 'hold'.
// Algunos envían 1 al pulsar y 0 al soltar (así detectamos "mantener"); otros solo un aviso por clic.
function makeButtonParser(fire) {
  let downAt = 0
  let sendsRelease = false
  let holdTimer
  return (value) => {
    const pressed = value.byteLength ? value.getUint8(0) !== 0 : true
    if (!pressed) {
      const wasFirstRelease = !sendsRelease
      sendsRelease = true
      clearTimeout(holdTimer)
      if (downAt && !wasFirstRelease) fire('click')
      downAt = 0
      return
    }
    downAt = Date.now()
    if (!sendsRelease) { fire('click'); return }
    holdTimer = setTimeout(() => { if (downAt) { downAt = 0; fire('hold') } }, HOLD_MS)
  }
}

async function connectItag(slot) {
  await ensureBle()
  const dev = await BleClient.requestDevice({ optionalServices: [...BUTTON_SERVICES, numberToUUID(0x180f)] })
  const name = dev.name || 'Botón Bluetooth'
  itags.set(slot, { deviceId: dev.deviceId, name, status: 'connecting' })
  try {
    await BleClient.connect(dev.deviceId, () => {
      if (itags.slots[slot]?.deviceId === dev.deviceId) itags.set(slot, { ...itags.slots[slot], status: 'lost' })
    })
    // Evita que el dispositivo pite al perder la conexión
    BleClient.write(dev.deviceId, LINK_LOSS_SVC, ALERT_LEVEL, numbersToDataView([0])).catch(() => {})

    // Busca todas las características que avisan (notify / indicate); la del iTag clásico primero
    const services = await BleClient.getServices(dev.deviceId)
    const targets = services.flatMap((s) => s.characteristics
      .filter((c) => (c.properties.notify || c.properties.indicate) && !NOT_BUTTONS.has(c.uuid.toLowerCase()))
      .map((c) => [s.uuid, c.uuid]))
    targets.sort(([, a]) => (a.toLowerCase() === ITAG_BTN ? -1 : 0))

    // Un mismo clic puede llegar por dos características: se ignora el duplicado
    let last = { t: 0, src: null }
    const fireFrom = (src) => (kind) => {
      const now = Date.now()
      if (kind === 'click' && src !== last.src && now - last.t < 150) return
      last = { t: now, src }
      itags.handlers[slot]?.(kind)
    }

    let listening = 0
    for (const [svc, chr] of targets) {
      try {
        await BleClient.startNotifications(dev.deviceId, svc, chr, makeButtonParser(fireFrom(chr)))
        listening++
      } catch { /* esa característica no permite avisos */ }
    }
    if (!listening) throw new Error(`${name} no envía avisos al pulsar su botón. Prueba con otro rastreador o con un botón selfie.`)
    itags.set(slot, { deviceId: dev.deviceId, name, status: 'connected' })
  } catch (e) {
    itags.set(slot, null)
    BleClient.disconnect(dev.deviceId).catch(() => {})
    throw e
  }
}

async function beepItag(slot) {
  const s = itags.slots[slot]
  if (!s) return
  try {
    await BleClient.write(s.deviceId, ALERT_SVC, ALERT_LEVEL, numbersToDataView([2]))
    setTimeout(() => BleClient.write(s.deviceId, ALERT_SVC, ALERT_LEVEL, numbersToDataView([0])).catch(() => {}), 600)
  } catch { /* algunos rastreadores no permiten sonar */ }
}

async function disconnectItag(slot) {
  const s = itags.slots[slot]
  itags.set(slot, null)
  if (s) await BleClient.disconnect(s.deviceId).catch(() => {})
}

/* ── Botones selfie (AB Shutter 3 y similares) ──
   Se emparejan desde los ajustes Bluetooth del teléfono y funcionan como un teclado:
   el botón "Android" envía Enter y el botón "iOS" envía Subir volumen.
   En el navegador llega Enter (y cualquier otra tecla); el volumen solo se puede leer en la app nativa. */
const KEY_NAMES = {
  Enter: 'Enter', NumpadEnter: 'Enter', Space: 'Espacio', AudioVolumeUp: 'Subir volumen', AudioVolumeDown: 'Bajar volumen',
  VolumeUp: 'Subir volumen', VolumeDown: 'Bajar volumen', ArrowUp: 'Flecha ↑', ArrowDown: 'Flecha ↓',
  ArrowLeft: 'Flecha ←', ArrowRight: 'Flecha →', PageUp: 'Pág ↑', PageDown: 'Pág ↓', MediaPlayPause: 'Play/Pausa',
  MediaTrackNext: 'Siguiente', MediaTrackPrevious: 'Anterior',
}
const keyId = (e) => {
  if (e.code && e.code !== 'Unidentified') return e.code
  if (e.key && e.key !== 'Unidentified') return e.key
  return `kc${e.keyCode}` // algunos botones solo traen el código numérico
}
const APK_URL = 'https://github.com/cashlessmot2026/padel-marcador/releases/download/android-latest/itag-score.apk'
const isAndroidWeb = !isNative && typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)
const keyLabel = (id) => KEY_NAMES[id] ?? id.replace(/^Key/, '').replace(/^Digit/, '')

const selfie = {
  keys: (() => { try { return JSON.parse(localStorage.getItem('selfieKeys')) ?? [null, null] } catch { return [null, null] } })(),
  learning: null, // jugador que está esperando su botón
  listeners: new Set(),
  emit() { this.snap = { keys: this.keys, learning: this.learning }; this.listeners.forEach((l) => l()) },
  assign(slot, id) {
    this.keys = this.keys.map((k, i) => (i === slot ? id : k === id ? null : k)) // una tecla, un jugador
    try { localStorage.setItem('selfieKeys', JSON.stringify(this.keys)) } catch { /* ignore */ }
    this.learning = null
    this.emit()
  },
  learn(slot) { this.learning = slot; this.emit() },
  subscribe(l) { selfie.listeners.add(l); return () => selfie.listeners.delete(l) },
  snapshot() { return selfie.snap },
}
selfie.snap = { keys: selfie.keys, learning: null }

// Una pulsación de tecla/botón: corta = clic, larga = mantener
const keyState = {}
function keyDown(id) {
  if (selfie.learning !== null) { selfie.assign(selfie.learning, id); blip(1200); return true }
  const slot = selfie.keys.indexOf(id)
  if (slot < 0 || !itags.handlers[slot]) return false
  if (keyState[id]) return true // auto-repetición mientras se mantiene
  keyState[id] = { fired: false, t: setTimeout(() => { keyState[id].fired = true; itags.handlers[slot]?.('hold') }, HOLD_MS) }
  return true
}
function keyUp(id) {
  const st = keyState[id]
  if (!st) return false
  clearTimeout(st.t)
  delete keyState[id]
  const slot = selfie.keys.indexOf(id)
  if (!st.fired && slot >= 0) itags.handlers[slot]?.('click')
  return true
}

if (typeof window !== 'undefined') {
  const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '') || e.target?.isContentEditable
  window.addEventListener('keydown', (e) => {
    if (typing(e) && selfie.learning === null) return
    if (keyDown(keyId(e))) { e.preventDefault(); document.activeElement?.blur?.() }
  }, true)
  window.addEventListener('keyup', (e) => { if (keyUp(keyId(e))) e.preventDefault() }, true)
}

// App nativa: el botón "iOS" del selfie (Subir volumen) llega como botón de volumen del teléfono
let volumeWatching = false
async function watchVolumeButtons(on) {
  if (!isNative || on === volumeWatching) return
  volumeWatching = on
  try {
    if (!on) return await VolumeButtons.clearWatch()
    await VolumeButtons.watchVolume({ disableSystemVolumeHandler: true, suppressVolumeIndicator: true }, (r) => {
      const id = r?.direction === 'down' ? 'VolumeDown' : 'VolumeUp'
      // El volumen no avisa al soltar: cada pulsación cuenta como clic
      if (keyDown(id)) keyUp(id)
    })
  } catch { volumeWatching = false }
}

/* ═════════════════════════ UTILIDADES DE PANTALLA / SONIDO ═════════════════════════ */
let audioCtx
function blip(freq = 880) {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)()
    const o = audioCtx.createOscillator(), g = audioCtx.createGain()
    o.frequency.value = freq
    g.gain.setValueAtTime(0.15, audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18)
    o.connect(g).connect(audioCtx.destination)
    o.start()
    o.stop(audioCtx.currentTime + 0.2)
  } catch { /* sin audio */ }
}

// Aplausos sintetizados: muchas palmadas cortas de ruido filtrado (no necesita archivos de audio)
let applauseBuf
function applause(seconds = 1.6, volume = 0.5) {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)()
    const ctx = audioCtx
    if (ctx.state === 'suspended') ctx.resume()
    const sr = ctx.sampleRate
    if (!applauseBuf || applauseBuf.duration < seconds) {
      const len = Math.floor(sr * 3)
      applauseBuf = ctx.createBuffer(2, len, sr)
      for (let ch = 0; ch < 2; ch++) {
        const d = applauseBuf.getChannelData(ch)
        for (let k = 0; k < 900; k++) { // ~300 palmadas por segundo entre muchas personas
          const at = Math.floor(Math.random() * len)
          const clapLen = Math.floor(sr * (0.008 + Math.random() * 0.02))
          const amp = 0.25 + Math.random() * 0.75
          for (let i = 0; i < clapLen && at + i < len; i++) {
            d[at + i] += (Math.random() * 2 - 1) * amp * Math.exp((-i / clapLen) * 5)
          }
        }
      }
    }
    const src = ctx.createBufferSource()
    src.buffer = applauseBuf
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 1800
    band.Q.value = 0.6
    const gain = ctx.createGain()
    const t0 = ctx.currentTime
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.08)
    gain.gain.setValueAtTime(volume, t0 + seconds * 0.55)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds)
    src.connect(band).connect(gain).connect(ctx.destination)
    src.start(t0, Math.random() * Math.max(0, applauseBuf.duration - seconds), seconds)
  } catch { /* sin audio */ }
}

function speak(text) {
  if (!('speechSynthesis' in window)) return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'es-ES'
  speechSynthesis.speak(u)
}

function useWakeLock(active) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let lock
    const req = () => navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {})
    req()
    const onVis = () => document.visibilityState === 'visible' && req()
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); lock?.release().catch(() => {}) }
  }, [active])
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) return await document.exitFullscreen()
    await document.documentElement.requestFullscreen()
    await screen.orientation?.lock?.('landscape').catch(() => {})
  } catch { /* iOS Safari no tiene fullscreen API: usar "Añadir a pantalla de inicio" */ }
}

const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }

/* ═════════════════════════ APP ═════════════════════════ */
export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [matchId, setMatchId] = useState(null)
  // En desarrollo, abre la ventana de la clave con #demo-clave para revisarla
  const [newPassword, setNewPassword] = useState(() =>
    import.meta.env.DEV && window.location.hash === '#demo-clave' ? generatePassword() : null)
  const [recoveryError, setRecoveryError] = useState(null)

  // Tras validar la recuperación por correo: genera una clave nueva y la muestra 5 s
  const revealing = useRef(false)
  const issueNewPassword = useCallback(async () => {
    if (revealing.current) return
    revealing.current = true
    const pwd = generatePassword()
    const { error } = await supabase.auth.updateUser({ password: pwd })
    revealing.current = false
    if (error) return setRecoveryError(translateAuthError(error.message))
    setNewPassword(pwd)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      // El usuario llegó desde el enlace "recuperar contraseña" del correo
      if (event === 'PASSWORD_RECOVERY') setTimeout(issueNewPassword, 0)
    })
    return () => data.subscription.unsubscribe()
  }, [issueNewPassword])

  useEffect(() => {
    if (!session) { setProfile(null); return }
    const meta = session.user.user_metadata ?? {}
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => setProfile(data ?? {
        id: session.user.id,
        username: meta.username ?? meta.user_name ?? session.user.email?.split('@')[0] ?? '',
        display_name: meta.display_name ?? meta.full_name ?? meta.name ?? 'Jugador',
      }))
  }, [session])

  const overlays = (
    <>
      {newPassword && <PasswordReveal password={newPassword} onClose={() => setNewPassword(null)} />}
      {recoveryError && (
        <div className="modal" onClick={() => setRecoveryError(null)}>
          <div className="card sheet center-text"><p className="err">{recoveryError}</p>
            <button className="btn block">Cerrar</button></div>
        </div>
      )}
    </>
  )

  if (DEMO && window.location.hash === '#demo-match')
    return <Match id="demo" me={{ id: 'demo', display_name: 'Demo' }} onExit={() => { window.location.hash = '' }} />
  if (DEMO && window.location.hash === '#demo-setup')
    return <div className="home"><section className="card"><h3>Nuevo partido</h3>
      <GameSetup me={{ display_name: 'Ana y Luis' }} onStart={async (c, n) => console.log('start', c, n)} onCancel={() => {}} /></section></div>
  if (session === undefined) return <div className="center muted">Cargando…</div>
  if (!session) return <><Auth onRecovered={issueNewPassword} />{overlays}</>
  if (!profile) return <div className="center muted">Cargando perfil…</div>
  return (
    <>
      {matchId
        ? <Match id={matchId} me={profile} onExit={() => setMatchId(null)} />
        : <Home me={profile} onOpen={setMatchId} />}
      {overlays}
    </>
  )
}

function generatePassword(len = 12) {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%*?']
  const all = sets.join('')
  const rnd = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n
  const chars = sets.map((s) => s[rnd(s.length)])
  while (chars.length < len) chars.push(all[rnd(all.length)])
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rnd(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const t = Object.assign(document.createElement('textarea'), { value: text })
    document.body.appendChild(t)
    t.select()
    const ok = document.execCommand('copy')
    t.remove()
    return ok
  }
}

const WEB_URL = 'https://cashlessmot2026.github.io/padel-marcador/'
// En la app nativa los enlaces de los correos abren la web publicada
const REDIRECT_URL = isNative ? WEB_URL
  : typeof window !== 'undefined' ? window.location.origin + window.location.pathname : undefined

// Proveedores conocidos: solo se muestran los que estén activos en Supabase
const PROVIDERS = {
  google: { label: 'Google', icon: <svg viewBox="0 0 24 24"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z" /></svg> },
  apple: { label: 'Apple', icon: <svg viewBox="0 0 24 24"><path fill="currentColor" d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.5 1.3-.1 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.6-1-2.6-4.1zM13.9 5c.7-.8 1.2-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z" /></svg> },
  github: { label: 'GitHub', icon: <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.5 11.5 0 0 0 23.5 12C23.5 5.7 18.3.5 12 .5z" /></svg> },
  facebook: { label: 'Facebook', icon: <svg viewBox="0 0 24 24"><path fill="#1877F2" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z" /></svg> },
  azure: { label: 'Microsoft', icon: <svg viewBox="0 0 24 24"><path fill="#F25022" d="M1 1h10v10H1z" /><path fill="#7FBA00" d="M13 1h10v10H13z" /><path fill="#00A4EF" d="M1 13h10v10H1z" /><path fill="#FFB900" d="M13 13h10v10H13z" /></svg> },
  discord: { label: 'Discord' },
  twitter: { label: 'X' },
  gitlab: { label: 'GitLab' },
  spotify: { label: 'Spotify' },
  twitch: { label: 'Twitch' },
  linkedin_oidc: { label: 'LinkedIn' },
  slack_oidc: { label: 'Slack' },
  notion: { label: 'Notion' },
}

function useEnabledProviders() {
  const [list, setList] = useState([])
  useEffect(() => {
    fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } })
      .then((r) => r.json())
      .then((s) => setList(Object.keys(PROVIDERS).filter((k) => s?.external?.[k])))
      .catch(() => {})
  }, [])
  return list
}

function passwordScore(p) {
  let s = 0
  if (p.length >= 8) s++
  if (p.length >= 12) s++
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++
  if (/\d/.test(p)) s++
  if (/[^A-Za-z0-9]/.test(p)) s++
  return Math.min(4, s)
}

function Field({ icon, label, type = 'text', value, onChange, hint, hintOk, ...rest }) {
  const [show, setShow] = useState(false)
  const isPwd = type === 'password'
  return (
    <label className={`field ${value ? 'filled' : ''}`}>
      <span className="ficon" aria-hidden>{icon}</span>
      <input type={isPwd && show ? 'text' : type} value={value} onChange={onChange} placeholder=" " {...rest} />
      <span className="flabel">{label}</span>
      {isPwd && (
        <button type="button" className="eye" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar clave' : 'Mostrar clave'}>
          {show ? '🙈' : '👁'}
        </button>
      )}
      {hint && <span className={`fhint ${hintOk === true ? 'ok' : hintOk === false ? 'err' : ''}`}>{hint}</span>}
    </label>
  )
}

function translateAuthError(m = '') {
  const map = [
    [/invalid login credentials/i, 'Correo o contraseña incorrectos'],
    [/email not confirmed/i, 'Confirma tu correo antes de entrar'],
    [/user already registered/i, 'Ese correo ya tiene una cuenta'],
    [/password should be at least/i, 'La contraseña debe tener al menos 6 caracteres'],
    [/token has expired|otp.*(expired|invalid)|invalid.*token/i, 'Código inválido o vencido'],
    // Límite del servidor de Supabase (se configura en el panel, no en la app)
    [/after (\d+) seconds?/i, (s) => `Supabase pide esperar ${s.match(/after (\d+)/i)[1]} s antes de enviar otro correo`],
    [/rate limit/i, 'Supabase limitó los envíos de correo. Intenta más tarde o sube el límite en Supabase'],
    [/provider is not enabled/i, 'Ese proveedor no está activado'],
    [/database error saving new user/i, 'No se pudo crear el usuario (¿ese usuario ya existe?)'],
  ]
  const hit = map.find(([r]) => r.test(m))?.[1]
  return typeof hit === 'function' ? hit(m) : hit ?? m
}

/* ─────────────── Login / Registro / Recuperar ─────────────── */
function Auth({ onRecovered }) {
  const [view, setView] = useState('login') // login | signup | forgot | code
  const [f, setF] = useState({ name: '', username: '', email: '', password: '', code: '' })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(0)
  const [userFree, setUserFree] = useState(null)
  const providers = useEnabledProviders()
  const up = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const go = (v) => { setView(v); setMsg(null) }

  // Disponibilidad del usuario en vivo, validada contra la base de datos
  useEffect(() => {
    if (view !== 'signup') return
    const u = f.username.trim().toLowerCase()
    if (!/^[a-z0-9_]{3,20}$/.test(u)) { setUserFree(u ? 'invalid' : null); return }
    setUserFree('checking')
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('username_available', { u })
      setUserFree(error ? null : data ? 'free' : 'taken')
    }, 350)
    return () => clearTimeout(t)
  }, [f.username, view])

  async function run(fn) {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
    } catch (err) {
      setMsg({ ok: false, text: translateAuthError(err.message) })
      setShake((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  const submit = (e) => {
    e.preventDefault()
    run(async () => {
      const email = f.email.trim()
      if (view === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: f.password })
        if (error) throw error
      } else if (view === 'signup') {
        const username = f.username.trim().toLowerCase()
        if (userFree === 'invalid') throw new Error('Usuario: 3-20 letras minúsculas, números o _')
        if (userFree === 'taken') throw new Error('Ese usuario ya existe')
        const { data, error } = await supabase.auth.signUp({
          email,
          password: f.password,
          options: { data: { username, display_name: f.name.trim() || username }, emailRedirectTo: REDIRECT_URL },
        })
        if (error) throw error
        if (!data.session) {
          setView('login')
          setMsg({ ok: true, text: '✉️ Te enviamos un correo para confirmar tu cuenta.' })
        }
      } else if (view === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: REDIRECT_URL })
        if (error) throw error
        setView('code')
        setMsg({ ok: true, text: `✉️ Enviamos un correo a ${email}. Abre el enlace o escribe aquí el código.` })
      } else if (view === 'code') {
        const { error } = await supabase.auth.verifyOtp({ email, token: f.code.trim(), type: 'recovery' })
        if (error) throw error
        await onRecovered()
      }
    })
  }

  const oauth = (provider) => run(async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: REDIRECT_URL } })
    if (error) throw error
  })

  const score = passwordScore(f.password)
  const titles = {
    login: ['Bienvenido de vuelta', 'Entra para llevar el marcador'],
    signup: ['Crea tu cuenta', 'En menos de 30 segundos'],
    forgot: ['¿Olvidaste tu clave?', 'Te ayudamos a recuperarla con tu correo'],
    code: ['Revisa tu correo', 'Valida que eres tú'],
  }
  const cta = {
    login: 'Entrar', signup: 'Crear cuenta', forgot: 'Enviar correo de recuperación', code: 'Validar y ver mi nueva clave',
  }
  const hints = { invalid: '3-20 letras minúsculas, números o _', checking: 'Comprobando…', free: '✓ Disponible', taken: '✗ Ya está en uso' }

  return (
    <div className="auth2">
      <div className="blobs" aria-hidden><i /><i /><i /></div>
      <div className={`auth-card ${shake ? 'shake' : ''}`} key={shake}>
        <div className="brand"><span className="ball spin" /> iTag Score</div>

        {(view === 'login' || view === 'signup') && (
          <div className="switch" data-pos={view === 'signup' ? 1 : 0}>
            <span className="pill-bg" />
            <button type="button" className={view === 'login' ? 'on' : ''} onClick={() => go('login')}>Entrar</button>
            <button type="button" className={view === 'signup' ? 'on' : ''} onClick={() => go('signup')}>Registrarse</button>
          </div>
        )}

        <div className="view" key={view}>
          <h1>{titles[view][0]}</h1>
          <p className="muted sub">{titles[view][1]}</p>

          <form onSubmit={submit} className="fields">
            {view === 'signup' && (
              <>
                <Field icon="👤" label="Tu nombre" value={f.name} onChange={up('name')} autoComplete="name" required />
                <Field icon="@" label="Usuario" value={f.username} onChange={up('username')} autoCapitalize="none"
                  autoComplete="username" required hint={hints[userFree]}
                  hintOk={userFree === 'free' ? true : userFree === 'taken' || userFree === 'invalid' ? false : undefined} />
              </>
            )}

            {view !== 'code' && (
              <Field icon="✉️" label="Correo electrónico" type="email" value={f.email} onChange={up('email')}
                autoComplete="email" inputMode="email" required />
            )}

            {(view === 'login' || view === 'signup') && (
              <Field icon="🔒" label="Contraseña" type="password" value={f.password} onChange={up('password')}
                minLength={6} required autoComplete={view === 'signup' ? 'new-password' : 'current-password'} />
            )}

            {view === 'signup' && f.password && (
              <div className="strength" data-score={score}>
                <span /><span /><span /><span />
                <em>{['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Excelente'][score]}</em>
              </div>
            )}

            {view === 'code' && (
              <Field icon="🔑" label="Código del correo" value={f.code} onChange={up('code')} inputMode="numeric"
                autoComplete="one-time-code" pattern="[0-9]{6,10}" required />
            )}

            {view === 'login' && (
              <button type="button" className="linkbtn right" onClick={() => go('forgot')}>¿Olvidaste tu contraseña?</button>
            )}

            {msg && <p className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>}

            <button className="cta" disabled={busy}>{busy ? <span className="spinner" /> : cta[view]}</button>
          </form>

          {(view === 'forgot' || view === 'code') && (
            <button type="button" className="linkbtn" onClick={() => go('login')}>← Volver a entrar</button>
          )}

          {(view === 'login' || view === 'signup') && providers.length > 0 && (
            <>
              <div className="divider"><span>o continúa con</span></div>
              <div className="providers">
                {providers.map((p) => (
                  <button key={p} type="button" className="prov" onClick={() => oauth(p)} disabled={busy}>
                    {PROVIDERS[p].icon ?? <b>{PROVIDERS[p].label[0]}</b>}
                    <span>{PROVIDERS[p].label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* Ventana emergente: nueva clave visible 5 s con botón para copiar */
function PasswordReveal({ password, onClose }) {
  const SECONDS = 5
  const [left, setLeft] = useState(SECONDS)
  const [copied, setCopied] = useState(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const started = Date.now()
    const t = setInterval(() => {
      const l = SECONDS - (Date.now() - started) / 1000
      if (l <= 0) {
        clearInterval(t)
        closeRef.current()
      } else setLeft(l)
    }, 100)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="modal reveal-bg">
      <div className="reveal" role="dialog" aria-label="Tu nueva clave de acceso">
        <svg className="ring" viewBox="0 0 44 44" aria-hidden>
          <circle cx="22" cy="22" r="20" />
          <circle cx="22" cy="22" r="20" className="prog" style={{ strokeDashoffset: 125.66 * (1 - left / SECONDS) }} />
          <text x="22" y="27">{Math.ceil(left)}</text>
        </svg>
        <h2>Tu nueva clave de acceso</h2>
        <p className="muted small">Se ocultará en {Math.ceil(left)} s · ya iniciaste sesión con ella</p>
        <code className="pwd">{password}</code>
        <button className={`cta ${copied ? 'done' : ''}`} onClick={async () => setCopied(await copyText(password))}>
          {copied ? '✓ Copiada al portapapeles' : '📋 Copiar clave'}
        </button>
      </div>
    </div>
  )
}

const SPORTS = { padel: '🎾 Pádel', tennis: '🎾 Tenis', points: '🏓 Por puntos' }
const sportName = (m) => {
  const c = m?.state?.cfg
  if (!c) return m?.mode === 'points' ? `A ${m.target} pts` : 'Tenis'
  return c.sport === 'points' ? `A ${c.target} pts` : c.sport === 'padel' ? 'Pádel' : 'Tenis'
}

function Seg({ value, options, onChange }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={String(v)} type="button" className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  )
}

function Toggle({ checked, onChange, children }) {
  return (
    <label className="toggle">
      <span>{children}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden />
    </label>
  )
}

/* ─────────────── Configurar el juego ─────────────── */
function GameSetup({ me, opponent, onStart, onCancel }) {
  const [cfg, setCfg] = useState(() => ({ ...DEFAULT_CFG, ...lsGet('lastCfg', {}) }))
  const [names, setNames] = useState([me.display_name, opponent?.display_name ?? ''])
  const [busy, setBusy] = useState(false)
  const set = (k) => (v) => setCfg((c) => ({ ...c, [k]: v }))
  const minutesPreset = [0, 30, 45, 60, 90]

  // Al cambiar de deporte, valores típicos
  const setSport = (sport) => setCfg((c) => ({
    ...c, sport,
    golden: sport === 'padel' ? true : sport === 'tennis' ? false : c.golden,
    scoring: sport === 'points' ? c.scoring : c.scoring,
  }))

  async function start(e) {
    e.preventDefault()
    setBusy(true)
    const clean = { ...cfg, target: Math.max(1, Number(cfg.target) || 11), minutes: Math.max(0, Number(cfg.minutes) || 0) }
    await onStart(clean, names.map((n, i) => n.trim() || `Jugador ${i + 1}`))
    setBusy(false)
  }

  const pts = cfg.sport === 'points'
  return (
    <form className="setup" onSubmit={start}>
      <button type="button" className="btn ghost sm back" onClick={onCancel}>← Volver</button>

      <div className="setup-sec">
        <h4>Jugadores</h4>
        <div className="names">
          <input placeholder={cfg.sport === 'padel' ? 'Pareja 1 (ej. Ana y Luis)' : 'Jugador 1'} value={names[0]}
            onChange={(e) => setNames([e.target.value, names[1]])} maxLength={40} required />
          <span className="vs-dot">vs</span>
          {opponent ? (
            <div className="fixed-name">{opponent.display_name} <span className="muted small">(invitado)</span></div>
          ) : (
            <input placeholder={cfg.sport === 'padel' ? 'Pareja 2 (ej. Sol y Mar)' : 'Jugador 2'} value={names[1]}
              onChange={(e) => setNames([names[0], e.target.value])} maxLength={40} required autoFocus />
          )}
        </div>
      </div>

      <div className="setup-sec">
        <h4>Tipo de juego</h4>
        <Seg value={cfg.sport} onChange={setSport} options={Object.entries(SPORTS)} />
      </div>

      <div className="setup-sec">
        <h4>Puntaje</h4>
        {pts ? (
          <>
            <Seg value={Number(cfg.target)} onChange={set('target')} options={[[11, 'A 11'], [15, 'A 15'], [21, 'A 21']]} />
            <label className="inline small">Otro:
              <input type="number" min="1" max="99" value={cfg.target} onChange={(e) => set('target')(e.target.value)} />
              puntos por set (gana por 2)
            </label>
          </>
        ) : (
          <>
            <Seg value={cfg.scoring} onChange={set('scoring')} options={[['classic', '15 · 30 · 40'], ['numeric', '1 · 2 · 3']]} />
            <Toggle checked={cfg.golden} onChange={set('golden')}>
              <b>Punto de oro</b> <span className="muted small">en 40-40 el siguiente punto gana el juego</span>
            </Toggle>
            <div className="two">
              <div>
                <span className="small muted">Juegos por set</span>
                <Seg value={cfg.gamesPerSet} onChange={set('gamesPerSet')} options={[[4, '4'], [6, '6']]} />
              </div>
              <div>
                <span className="small muted">Tie-break</span>
                <Seg value={cfg.tiebreak} onChange={set('tiebreak')} options={[[true, 'Sí'], [false, 'No']]} />
              </div>
            </div>
          </>
        )}
        <span className="small muted">Sets</span>
        <Seg value={cfg.setsToWin} onChange={set('setsToWin')}
          options={[[1, '1 set'], [2, 'Mejor de 3'], [3, 'Mejor de 5'], [0, 'Libre']]} />
      </div>

      <div className="setup-sec">
        <h4>⏱ Tiempo de juego</h4>
        <Seg value={minutesPreset.includes(Number(cfg.minutes)) ? Number(cfg.minutes) : 'x'} onChange={(v) => set('minutes')(v === 'x' ? 20 : v)}
          options={[[0, 'Sin límite'], [30, '30′'], [45, '45′'], [60, '60′'], [90, '90′'], ['x', 'Otro']]} />
        {!minutesPreset.includes(Number(cfg.minutes)) && (
          <label className="inline small">
            <input type="number" min="1" max="600" value={cfg.minutes} onChange={(e) => set('minutes')(e.target.value)} /> minutos
          </label>
        )}
      </div>

      <div className="setup-sec">
        <h4>🔊 Sonido</h4>
        <Toggle checked={cfg.applause} onChange={set('applause')}>👏 Aplausos en cada punto</Toggle>
        <Toggle checked={cfg.voiceName} onChange={set('voiceName')}>🗣 Voz que dice quién anotó</Toggle>
        <Toggle checked={cfg.voiceScore} onChange={set('voiceScore')}>📢 Voz que canta el marcador</Toggle>
        <button type="button" className="btn ghost sm" onClick={() => {
          if (cfg.applause) applause()
          const n = names[0].trim() || 'Jugador 1'
          speak([cfg.voiceName && `Punto para ${n}`, cfg.voiceScore && (pts ? 'Uno, cero' : 'Quince, cero')].filter(Boolean).join('. '))
        }}>▶ Probar sonido</button>
      </div>

      <button className="cta" disabled={busy}>
        {busy ? <span className="spinner" /> : opponent ? `Invitar a ${opponent.display_name}` : '▶ Empezar partido'}
      </button>
    </form>
  )
}

/* ─────────────── Inicio: buscar, invitar, invitaciones, historial ─────────────── */
function Home({ me, onOpen }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [flow, setFlow] = useState(null) // null | 'quick' | 'invite'
  const [opponent, setOpponent] = useState(null) // perfil del jugador invitado
  const [matches, setMatches] = useState([])
  const [err, setErr] = useState(null)

  const [newInvite, setNewInvite] = useState(false)
  const seenInvites = useRef(null)
  const waitingIds = useRef(new Set())

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('matches').select('*')
      .or(`host_id.eq.${me.id},player1_id.eq.${me.id},player2_id.eq.${me.id}`)
      .order('created_at', { ascending: false }).limit(40)
    if (error) return
    const rows = data ?? []
    setMatches(rows)

    // Aviso de invitación nueva (sonido + vibración)
    const inv = rows.filter((m) => m.status === 'invited' && m.player2_id === me.id).map((m) => m.id)
    if (seenInvites.current && inv.some((id) => !seenInvites.current.has(id))) {
      blip(990); setTimeout(() => blip(1320), 160)
      navigator.vibrate?.([120, 80, 120])
      setNewInvite(true)
    }
    seenInvites.current = new Set(inv)

    // Si el rival aceptó mi invitación, abro el partido
    const accepted = rows.find((m) => waitingIds.current.has(m.id) && m.status === 'active')
    waitingIds.current = new Set(rows.filter((m) => m.status === 'invited' && m.host_id === me.id).map((m) => m.id))
    if (accepted) onOpen(accepted.id)
  }, [me.id, onOpen])

  // Tiempo real + revisión cada 5 s + al volver a la app (por si el tiempo real se corta)
  useEffect(() => {
    load()
    const ch = supabase.channel(`home-${me.id}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, load)
      .subscribe()
    const poll = setInterval(load, 5000)
    const onFocus = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
      supabase.removeChannel(ch)
    }
  }, [load, me.id])

  useEffect(() => { if (newInvite) { const t = setTimeout(() => setNewInvite(false), 4000); return () => clearTimeout(t) } }, [newInvite])

  // Lista de jugadores registrados: todos, o filtrados por la búsqueda
  useEffect(() => {
    const term = q.trim().replace(/[^\p{L}\p{N}_ ]/gu, '')
    const t = setTimeout(async () => {
      let query = supabase.from('profiles').select('id,username,display_name').neq('id', me.id)
      if (term) query = query.or(`username.ilike.%${term}%,display_name.ilike.%${term}%`)
      const { data } = await query.order('display_name').limit(200)
      setResults(data ?? [])
    }, term ? 250 : 0)
    return () => clearTimeout(t)
  }, [q, me.id])

  async function create(cfg, names) {
    setErr(null)
    lsSet('lastCfg', cfg)
    const invite = flow === 'invite' && opponent
    const { data, error } = await supabase.from('matches').insert({
      host_id: me.id,
      player1_id: me.id, player1_name: names[0],
      player2_id: invite ? opponent.id : null, player2_name: names[1],
      mode: isPoints(cfg) ? 'points' : 'tennis', target: cfg.target,
      status: invite ? 'invited' : 'active',
      state: newGame(cfg),
    }).select().single()
    if (error) return setErr(error.message)
    setFlow(null)
    setOpponent(null)
    setQ('')
    if (!invite) onOpen(data.id)
  }

  async function respond(m, accept) {
    await supabase.from('matches').update({ status: accept ? 'active' : 'declined' }).eq('id', m.id)
    if (accept) onOpen(m.id)
  }

  const invites = matches.filter((m) => m.status === 'invited' && m.player2_id === me.id)
  const waiting = matches.filter((m) => m.status === 'invited' && m.host_id === me.id)
  const live = matches.filter((m) => m.status === 'active')
  const done = matches.filter((m) => m.status === 'finished').slice(0, 15)

  return (
    <div className="home">
      <header className="top">
        <div className="brand sm"><span className="ball" /> iTag Score</div>
        <div className="who">
          <b>{me.display_name}</b> <span className="muted">@{me.username}</span>
          <button className="btn ghost sm" onClick={() => supabase.auth.signOut()}>Salir</button>
        </div>
      </header>

      {invites.length > 0 && (
        <section className={`card invite-card ${newInvite ? 'ping' : ''}`}>
          <h3>📨 Invitaciones</h3>
          {invites.map((m) => (
            <div key={m.id} className="row">
              <span><b>{m.player1_name}</b> te invita · {sportName(m)}</span>
              <span className="actions">
                <button className="btn primary sm" onClick={() => respond(m, true)}>Aceptar</button>
                <button className="btn ghost sm" onClick={() => respond(m, false)}>Rechazar</button>
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <h3>Nuevo partido</h3>
        {!flow && (
          <div className="start-options">
            <button className="start-opt" onClick={() => setFlow('quick')}>
              <span className="so-icon">⚡</span>
              <span><b>Partido rápido</b><br /><span className="muted small">Escribe los nombres y juega ya. No hace falta que el rival tenga cuenta.</span></span>
            </button>
            <button className="start-opt" onClick={() => setFlow('invite')}>
              <span className="so-icon">👥</span>
              <span><b>Invitar a un jugador registrado</b><br /><span className="muted small">Cada uno usa su teléfono y su botón; el marcador se sincroniza.</span></span>
            </button>
          </div>
        )}

        {flow === 'invite' && !opponent && (
          <>
            <button className="btn ghost sm back" onClick={() => setFlow(null)}>← Volver</button>
            <input placeholder="Buscar jugador por nombre o @usuario" value={q} onChange={(e) => setQ(e.target.value)}
              autoCapitalize="none" />
            <p className="muted small count">
              {q.trim() ? `${results.length} encontrado(s)` : `${results.length} jugador(es) registrado(s)`}
            </p>
            <div className="results players">
              {results.map((p) => (
                <button key={p.id} className="result" onClick={() => setOpponent(p)}>
                  <span className="avatar">{p.display_name[0]?.toUpperCase()}</span>
                  <span><b>{p.display_name}</b> <span className="muted">@{p.username}</span></span>
                  <span className="pill">Elegir</span>
                </button>
              ))}
              {!results.length && <p className="muted">{q.trim() ? 'Sin resultados' : 'Aún no hay otros jugadores'}</p>}
            </div>
          </>
        )}

        {(flow === 'quick' || (flow === 'invite' && opponent)) && (
          <GameSetup me={me} opponent={flow === 'invite' ? opponent : null} onStart={create}
            onCancel={() => { if (opponent) setOpponent(null); else setFlow(null) }} />
        )}
        {err && <p className="err">{err}</p>}
      </section>

      {(live.length > 0 || waiting.length > 0) && (
        <section className="card">
          <h3>En curso</h3>
          {live.map((m) => (
            <button key={m.id} className="row link" onClick={() => onOpen(m.id)}>
              <span><b>{m.player1_name}</b> vs <b>{m.player2_name}</b></span>
              <span className="pill live">● En vivo</span>
            </button>
          ))}
          {waiting.map((m) => (
            <div key={m.id} className="row">
              <span>Esperando a <b>{m.player2_name}</b>…</span>
              <button className="btn ghost sm" onClick={() => supabase.from('matches').delete().eq('id', m.id)}>Cancelar</button>
            </div>
          ))}
        </section>
      )}

      {done.length > 0 && (
        <section className="card">
          <h3>Historial</h3>
          {done.map((m) => (
            <div key={m.id} className="row">
              <span>{m.player1_name} vs {m.player2_name}
                <span className="muted"> · {(m.state?.setLog ?? []).map((s) => s.join('-')).join(', ')}</span></span>
              <span className="pill">🏆 {m.winner_name ?? 'Empate'}</span>
            </div>
          ))}
        </section>
      )}

      {!bleSupported && (
        <p className="warn">
          Este navegador no tiene Bluetooth. En iPhone usa la app nativa o el navegador <b>Bluefy</b>;
          en Android usa Chrome.
        </p>
      )}
    </div>
  )
}

/* ─────────────── Partido / Marcador ─────────────── */
function Match({ id, me, onExit }) {
  const [match, setMatch] = useState(null)
  const [s, dispatch] = useReducer(scoreReducer, { game: newGame(), past: [] })
  const [toast, setToast] = useState(null)
  const [showSetup, setShowSetup] = useState(false)
  const [soundOn, setSoundOn] = useState(() => lsGet('soundOn', true)) // sonidos en este teléfono
  const [timeUp, setTimeUp] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const slots = useSyncExternalStore(itags.subscribe, itags.snapshot)
  const keys = useSyncExternalStore(selfie.subscribe, selfie.snapshot)
  const chRef = useRef(null)
  const localRef = useRef(false)
  const mountedAt = useRef(Date.now())
  useWakeLock(true)

  const g = s.game
  const cfg = g.cfg ?? legacyCfg(match)
  const names = match ? [match.player1_name, match.player2_name] : ['', '']
  const mySlot = match?.player2_id === me.id && match?.host_id !== me.id ? 1 : 0
  const finished = match?.status === 'finished'

  // Cargar partido + suscripción en tiempo real
  useEffect(() => {
    if (DEMO && id === 'demo') { // solo en desarrollo: partido de prueba sin base de datos
      setMatch({ id, status: 'active', host_id: me.id, player1_name: 'Ana y Luis', player2_name: 'Sol y Mar' })
      dispatch({ type: 'remote', game: { ...newGame({ ...DEFAULT_CFG, minutes: 1 }), v: 1 } })
      return
    }
    let alive = true
    supabase.from('matches').select('*').eq('id', id).single().then(({ data }) => {
      if (!alive || !data) return
      setMatch(data)
      if (data.state) dispatch({ type: 'remote', game: { ...data.state, v: Math.max(data.state.v ?? 0, 1) } })
    })
    const ch = supabase.channel(`match-${id}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'state' }, ({ payload }) => dispatch({ type: 'remote', ...payload }))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${id}` },
        ({ new: row }) => {
          setMatch(row)
          if (row.state) dispatch({ type: 'remote', game: row.state })
        })
      .subscribe()
    chRef.current = ch
    return () => { alive = false; supabase.removeChannel(ch) }
  }, [id])

  // Acción local → aplicar, transmitir y guardar
  const act = useCallback((type, p) => {
    if (finished) return
    localRef.current = true
    dispatch({ type, p, cfg, v: Date.now() })
    if (type === 'undo') setToast('↩ Punto devuelto')
    if (type === 'reset') setToast('🧹 Marcador borrado · doble toque para recuperarlo')
  }, [finished, cfg])

  const finishMatch = useCallback(async (game) => {
    const w = winnerSlot(game)
    if (DEMO && id === 'demo') return setMatch((m) => ({ ...m, status: 'finished', winner_slot: w }))
    const { data } = await supabase.from('matches').update({
      status: 'finished', state: game, finished_at: new Date().toISOString(),
      winner_slot: w, winner_name: w === null ? null : names[w],
    }).eq('id', id).select().single()
    if (data) setMatch(data)
  }, [id, names])

  const saveTimer = useRef()
  useEffect(() => {
    if (!localRef.current) return
    localRef.current = false
    chRef.current?.send({ type: 'broadcast', event: 'state', payload: { game: g, past: s.past.slice(-30) } })
    clearTimeout(saveTimer.current)
    // Ganó los sets configurados: se finaliza solo
    if (g.winner === 0 || g.winner === 1) { finishMatch(g); return }
    if (DEMO && id === 'demo') return
    saveTimer.current = setTimeout(() => supabase.from('matches').update({ state: g }).eq('id', id), 400)
  }, [g]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sonidos y voz de cada acción (también las que llegan del otro teléfono)
  const lastEvt = useRef(null)
  const prevGame = useRef(g)
  useEffect(() => {
    const prev = prevGame.current
    prevGame.current = g
    const e = g.evt
    if (!e || e.id === lastEvt.current || e.id < mountedAt.current || !match) return
    lastEvt.current = e.id
    if (!soundOn) return
    if (e.type === 'point') {
      const p = e.p
      const wonGame = !isPoints(cfg) && g.games[p] + g.sets[p] > prev.games[p] + prev.sets[p] && g.points[0] + g.points[1] === 0
      const wonSet = g.sets[p] > (prev.sets?.[p] ?? 0)
      const wonMatch = g.winner === p
      if (cfg.applause) applause(wonMatch ? 3 : wonSet ? 2.6 : wonGame ? 2 : 1.4, wonMatch || wonSet ? 0.7 : 0.5)
      else blip(p === 0 ? 880 : 660)
      const parts = []
      if (wonMatch) parts.push(`¡${names[p]} gana el partido!`)
      else {
        if (cfg.voiceName) parts.push(wonSet ? `Set para ${names[p]}` : wonGame ? `Juego para ${names[p]}` : `Punto para ${names[p]}`)
        if (cfg.voiceScore) parts.push(announceText(g, cfg, names))
      }
      if (parts.length) speak(parts.join('. '))
    } else if (e.type === 'undo') {
      blip(330)
      if (cfg.voiceName || cfg.voiceScore) speak('Punto anulado')
    } else if (e.type === 'reset') blip(220)
  }, [g]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 1800); return () => clearTimeout(t) } }, [toast])

  // Reloj: refresca cada segundo y avisa cuando se cumple el tiempo de juego
  const running = !!g.clock?.start && !g.clock?.pausedAt && !finished
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])
  const elapsed = clockElapsed(g.clock, now)
  const limitMs = (Number(cfg.minutes) || 0) * 60000
  const remaining = limitMs ? limitMs - elapsed : null
  const timeUpAnnounced = useRef(false)
  useEffect(() => {
    if (!limitMs || remaining > 0 || timeUpAnnounced.current || finished) return
    timeUpAnnounced.current = true
    setTimeUp(true)
    if (soundOn) { applause(2.5, 0.6); speak('Tiempo cumplido') }
  }, [remaining, limitMs, finished, soundOn])

  // Conectar los botones de este dispositivo con el marcador
  const actRef = useRef(act)
  actRef.current = act
  const [pulse, setPulse] = useState({ p: null, n: 0 })
  useEffect(() => {
    const decoders = [0, 1].map((p) => makeClickDecoder((a) => actRef.current(a, p)))
    ;[0, 1].forEach((p) => {
      itags.handlers[p] = (kind) => {
        setPulse((x) => ({ p, n: x.n + 1 })) // destello: se ve que el botón llegó
        if (kind === 'hold') actRef.current('reset', p)
        else decoders[p]()
      }
    })
    watchVolumeButtons(true)
    return () => { itags.handlers = [null, null]; watchVolumeButtons(false) }
  }, [])

  async function finish() {
    if (!confirm('¿Finalizar el partido?')) return
    finishMatch(g)
  }

  if (!match) return <div className="center muted">Cargando partido…</div>
  if (match.status === 'invited')
    return (
      <div className="center col">
        <p>Esperando que <b>{match.player2_name}</b> acepte la invitación…</p>
        <button className="btn" onClick={onExit}>Volver</button>
      </div>
    )

  const { a: lbl, note } = labels(g, cfg)
  const format = [
    cfg.sport === 'padel' ? 'Pádel' : cfg.sport === 'tennis' ? 'Tenis' : `A ${cfg.target}`,
    cfg.setsToWin === 1 ? '1 set' : cfg.setsToWin ? `Mejor de ${cfg.setsToWin * 2 - 1}` : null,
    !isPoints(cfg) && cfg.golden ? 'Punto de oro' : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="board">
      {[0, 1].map((p) => (
        <Half key={p} p={p} name={names[p]} label={lbl[p]} serving={g.server === p}
          lit={g.last === p} onAction={(a) => act(a, p)} itag={slots[p]} selfieKey={keys.keys[p]}
          pulse={pulse.p === p ? pulse.n : 0} />
      ))}

      <div className="hud">
        <table className="sets">
          <tbody>
            {[0, 1].map((p) => (
              <tr key={p}>
                <td className="nm">{names[p]}</td>
                {g.setLog.map((set, i) => <td key={i} className={set[p] > set[1 - p] ? 'w' : ''}>{set[p]}</td>)}
                {!isPoints(cfg) && <td className="cur">{g.games[p]}</td>}
                <td className="tot">{g.sets[p]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {note && <div className="note">{note}</div>}
        <button className={`clock ${remaining !== null && remaining <= 0 ? 'over' : ''} ${g.clock?.pausedAt ? 'paused' : ''}`}
          onClick={() => act('clock')} title="Iniciar / pausar el reloj">
          {!g.clock?.start ? '▶ Iniciar reloj' : <>
            {g.clock.pausedAt ? '⏸' : '⏱'} {remaining !== null
              ? (remaining > 0 ? `${fmtClock(remaining)} restantes` : `Tiempo cumplido +${fmtClock(-remaining)}`)
              : fmtClock(elapsed)}
          </>}
        </button>
        <div className="format">{format}</div>
      </div>

      <div className="toolbar">
        <button title="Salir" onClick={onExit}>←</button>
        <button title="Deshacer" className="orange" onClick={() => act('undo', 0)}>↶</button>
        <button title="Anunciar" className="blue" onClick={() => speak(announceText(g, cfg, names))}>📢</button>
        <button title={soundOn ? 'Silenciar este teléfono' : 'Activar sonido'}
          onClick={() => { setSoundOn(!soundOn); lsSet('soundOn', !soundOn) }}>{soundOn ? '🔊' : '🔇'}</button>
        <button title="Cambiar saque" onClick={() => act('server', 0)}>🎾⇄</button>
        <button title="Botones (iTag, rastreador, selfie)" onClick={() => setShowSetup(true)}>
          📡 {[0, 1].filter((p) => slots[p]?.status === 'connected' || keys.keys[p]).length}/2
        </button>
        <button title="Pantalla completa / TV" onClick={toggleFullscreen}>⛶</button>
        <button title="Finalizar" className="red" onClick={finish}>🏁</button>
      </div>

      {toast && <div className="toast">{toast}</div>}

      {timeUp && !finished && (
        <div className="timeup">
          <b>⏱ ¡Tiempo cumplido!</b>
          <span>
            <button className="btn sm" onClick={() => setTimeUp(false)}>Seguir jugando</button>
            <button className="btn primary sm" onClick={() => finishMatch(g)}>🏁 Finalizar</button>
          </span>
        </div>
      )}

      {showSetup && (
        <ItagSetup names={names} mySlot={mySlot} slots={slots} keys={keys} pulse={pulse} autoSpeak={soundOn}
          setAutoSpeak={(v) => { setSoundOn(v); lsSet('soundOn', v) }} onClose={() => setShowSetup(false)} />
      )}

      {finished && <Winner match={match} game={g} names={names} onExit={onExit} />}
    </div>
  )
}

function Half({ p, name, label, serving, lit, onAction, itag, selfieKey, pulse }) {
  const decoder = useRef(null)
  const hold = useRef({ t: null, fired: false })
  const onActionRef = useRef(onAction)
  onActionRef.current = onAction
  decoder.current ??= makeClickDecoder((a) => onActionRef.current(a))

  const down = () => {
    hold.current.fired = false
    hold.current.t = setTimeout(() => { hold.current.fired = true; onActionRef.current('reset') }, 800)
  }
  const up = () => {
    clearTimeout(hold.current.t)
    if (!hold.current.fired) decoder.current()
  }
  const cancel = () => clearTimeout(hold.current.t)

  return (
    <div className={`half h${p} ${lit ? 'lit' : ''}`} onPointerDown={down} onPointerUp={up} onPointerLeave={cancel}
      onContextMenu={(e) => e.preventDefault()}>
      <div className="pname">
        <span className="tag">{name}</span>
        {itag && <span className={`dot ${itag.status}`} title={itag.name} />}
        {selfieKey && <span className="dot connected" title={`Botón selfie: ${keyLabel(selfieKey)}`} />}
      </div>
      {pulse > 0 && <span className="flash" key={pulse} />}
      {serving && <span className="serve" />}
      <div className="score">{label}</div>
    </div>
  )
}

function ItagSetup({ names, mySlot, slots, keys, pulse, autoSpeak, setAutoSpeak, onClose }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)

  async function link(slot) {
    setErr(null)
    setBusy(slot)
    try { await connectItag(slot) } catch (e) { if (!/cancel/i.test(e.message)) setErr(e.message) }
    setBusy(null)
  }

  // Al cerrar, deja de esperar un botón selfie
  const close = () => { if (selfie.learning !== null) { selfie.learning = null; selfie.emit() } onClose() }

  // Si a los 6 s no llegó ninguna tecla, casi seguro el botón solo envía "subir volumen"
  const [noKey, setNoKey] = useState(false)
  useEffect(() => {
    if (keys.learning === null) return
    setNoKey(false)
    const t = setTimeout(() => setNoKey(true), 6000)
    return () => clearTimeout(t)
  }, [keys.learning])

  const order = mySlot === 1 ? [1, 0] : [0, 1]
  const status = { connected: 'conectado', connecting: 'conectando…', lost: 'desconectado' }
  const sameKey = keys.keys[0] && keys.keys[0] === keys.keys[1]

  return (
    <div className="modal" onClick={close}>
      <div className="card sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Botones de los jugadores</h3>
        <p className="muted small">
          Cada jugador puede usar un <b>iTag o rastreador Bluetooth</b> y/o un <b>botón selfie</b>. Conéctalos en
          este teléfono, o cada jugador en el suyo: los puntos se sincronizan en vivo.
        </p>

        {order.map((slot) => {
          const s = slots[slot]
          const k = keys.keys[slot]
          const learning = keys.learning === slot
          return (
            <div key={slot} className={`player-block ${pulse.p === slot ? 'hit' : ''}`} data-n={pulse.p === slot ? pulse.n : 0}>
              <div className="pb-head">
                <b>{names[slot]}</b>{slot === mySlot && <span className="muted"> (tú)</span>}
                {pulse.p === slot && <span className="hit-dot" key={pulse.n}>● pulsó</span>}
              </div>

              <div className="row">
                <span>
                  📡 <span className="small">iTag / rastreador</span><br />
                  <span className={`small ${s?.status === 'connected' ? 'ok' : 'muted'}`}>
                    {s ? `${s.name} · ${status[s.status]}` : bleSupported ? 'Sin conectar' : 'Bluetooth no disponible aquí'}
                  </span>
                </span>
                <span className="actions">
                  {s?.status === 'connected' && <button className="btn ghost sm" title="Hacer sonar" onClick={() => beepItag(slot)}>🔔</button>}
                  {s ? (
                    <>
                      {s.status === 'lost' && <button className="btn sm" onClick={() => link(slot)}>Reconectar</button>}
                      <button className="btn ghost sm" onClick={() => disconnectItag(slot)}>Quitar</button>
                    </>
                  ) : (
                    <button className="btn primary sm" disabled={!bleSupported || busy !== null} onClick={() => link(slot)}>
                      {busy === slot ? 'Buscando…' : 'Vincular'}
                    </button>
                  )}
                </span>
              </div>

              <div className="row">
                <span>
                  📸 <span className="small">Botón selfie</span><br />
                  <span className={`small ${learning ? 'learning' : k ? 'ok' : 'muted'}`}>
                    {learning ? 'Pulsa ahora el botón selfie…' : k ? `Asignado: ${keyLabel(k)}` : 'Sin asignar'}
                  </span>
                </span>
                <span className="actions">
                  {learning ? (
                    <button className="btn ghost sm" onClick={() => { selfie.learning = null; selfie.emit() }}>Cancelar</button>
                  ) : (
                    <>
                      {k && <button className="btn ghost sm" onClick={() => selfie.assign(slot, null)}>Quitar</button>}
                      <button className={`btn sm ${k ? '' : 'primary'}`} onClick={() => selfie.learn(slot)}>
                        {k ? 'Cambiar' : 'Asignar'}
                      </button>
                    </>
                  )}
                </span>
              </div>
            </div>
          )
        })}

        {err && <p className="err small">{err}</p>}
        {keys.learning !== null && noKey && (
          <div className="warn small">
            <b>No llegó ninguna pulsación.</b> Revisa que el botón selfie esté emparejado en <i>Ajustes → Bluetooth</i>
            y prueba el otro botón (el marcado “Android”).
            {!isNative && (
              <> Si tu botón solo tiene uno, envía “subir volumen”, y el navegador no puede leerlo:
                {isAndroidWeb
                  ? <> instala la <a href={APK_URL}><b>app Android (APK)</b></a>, que sí lo lee.</>
                  : <> en Android instala la app (APK); en iPhone hace falta la app nativa compilada en Xcode.</>}
              </>
            )}
          </div>
        )}
        {sameKey &&<p className="warn small">Los dos jugadores tienen la misma tecla.</p>}

        <details className="help small">
          <summary>¿Cómo conecto mi botón?</summary>
          <p><b>iTag o rastreador Bluetooth:</b> enciéndelo (mantén presionado hasta que pite), pulsa <i>Vincular</i> y
            elígelo en la lista. Funcionan los iTag y la mayoría de rastreadores “anti-pérdida” genéricos. No funcionan
            AirTag, SmartTag ni Tile, porque sus marcas los bloquean.</p>
          <p><b>Botón selfie:</b> primero emparéjalo en los <i>Ajustes → Bluetooth</i> del teléfono. Luego pulsa
            <i> Asignar</i> y presiona el botón. En el navegador usa el botón <b>“Android”</b> (envía Enter). El botón
            “iOS” (subir volumen) solo funciona en la app nativa: en Android descarga la{' '}
            <a href={APK_URL}>app Android (APK)</a>; en iPhone hay que compilarla en Xcode.</p>
          <p><b>Dos botones selfie en el mismo teléfono</b> envían la misma tecla y no se pueden distinguir. Usa un
            botón selfie para un jugador y un iTag para el otro, o que cada jugador conecte su botón en su teléfono.</p>
        </details>

        <div className="legend small">
          <div><b>1 clic</b> → suma punto</div>
          <div><b>2 clics</b> → devuelve el último punto</div>
          <div><b>Mantener / 3 clics</b> → borra el marcador</div>
          <div className="muted">En pantalla: toca, doble toque o mantén presionada la mitad de cada jugador.</div>
        </div>
        <label className="inline small">
          <input type="checkbox" checked={autoSpeak} onChange={(e) => setAutoSpeak(e.target.checked)} />
          Sonidos y voz en este teléfono
        </label>
        <p className="muted small">📺 Para verlo en la TV usa “Duplicar pantalla” (Android / Chromecast) o AirPlay
          (iPhone) y pulsa ⛶.</p>
        <button className="btn block" onClick={close}>Listo</button>
      </div>
    </div>
  )
}

function Winner({ match, game, names, onExit }) {
  const w = match.winner_slot
  return (
    <div className="modal winner">
      <div className="card sheet center-text">
        <div className="trophy">🏆</div>
        {w === null || w === undefined ? <h2>¡Empate!</h2> : <><p className="muted">Ganador</p><h2>{names[w]}</h2></>}
        <table className="sets big">
          <tbody>
            {[0, 1].map((p) => (
              <tr key={p} className={w === p ? 'win' : ''}>
                <td className="nm">{names[p]}</td>
                {game.setLog.map((s, i) => <td key={i}>{s[p]}</td>)}
                {(game.games[0] + game.games[1] > 0 || game.points[0] + game.points[1] > 0) && (
                  <td className="cur">{isPoints(game.cfg ?? legacyCfg(match)) ? game.points[p] : game.games[p]}</td>
                )}
                <td className="tot">{game.sets[p]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {game.clock?.start && <p className="muted small">⏱ Duración: {fmtClock(clockElapsed(game.clock))}</p>}
        <button className="btn primary block" onClick={onExit}>Volver al inicio</button>
      </div>
    </div>
  )
}
