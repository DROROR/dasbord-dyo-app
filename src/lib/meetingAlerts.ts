// The noise a meeting makes: a beep, and a desktop notification that arrives
// even when the planner is behind another window.
//
// Both are deliberately kept out of the dialog component. The dialog can be
// dismissed, and a dismissed warning must not take the next one's sound with
// it; the top bar owns these instead, so they fire on their own schedule.

// ── Sound ───────────────────────────────────────────────────────────────────────

// A browser refuses to make any sound until the page has been interacted with,
// and a context created before that first click stays suspended forever. So one
// context is built on the first real gesture and kept — by the time a meeting
// is due, hours of clicking have already happened and it is ready.
let audio: AudioContext | null = null

function primeAudio() {
  if (audio) return
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    audio = new Ctor()
    void audio.resume?.()
  } catch {
    audio = null
  }
}

if (typeof window !== 'undefined') {
  for (const event of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(event, primeAudio, { once: false, passive: true })
  }
}

/**
 * Three short rising beeps. Loud enough to turn a head, short enough not to be
 * the reason somebody switches the tab's sound off.
 */
export function playMeetingBeep(times = 3) {
  primeAudio()
  if (!audio) return
  try {
    void audio.resume?.()
    for (let i = 0; i < times; i++) {
      const at = audio.currentTime + i * 0.3
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880 + i * 110, at)
      // Faded in and out: a square-edged tone clicks on most speakers.
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2)
      osc.connect(gain).connect(audio.destination)
      osc.start(at)
      osc.stop(at + 0.22)
    }
  } catch {
    // No audio device, or the context died with the tab.
  }
}

// ── Desktop notification ────────────────────────────────────────────────────────

/**
 * The same shape the rest of the app uses for its notifications (see
 * NotificationContext): the planner's icon, and a tag so a second warning
 * about the same meeting replaces the first rather than stacking under it.
 */
export function notifyMeeting(title: string, body: string, tag: string): boolean {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false
    const notification = new Notification(title, { body, icon: '/pwa-192.png', tag, requireInteraction: false })
    notification.onclick = () => { window.focus(); notification.close() }
    return true
  } catch {
    return false
  }
}

export function meetingNotificationsAllowed(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted'
}
