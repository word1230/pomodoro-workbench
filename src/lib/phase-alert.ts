export type PhaseAlertKind = 'focus_complete' | 'break_complete'

export interface PhaseAlertStep {
  frequency: number
  durationMs: number
  gain: number
  pauseAfterMs?: number
}

export interface PhaseAlertPreset {
  pattern: readonly PhaseAlertStep[]
  repeatCount: number
  repeatGapMs: number
}

type AudioContextConstructor = new () => AudioContext

const SILENT_GAIN = 0.0001
const MAX_ALERT_GAIN = 0.28

const phaseAlertPresets: Record<PhaseAlertKind, PhaseAlertPreset> = {
  focus_complete: {
    pattern: [
      { frequency: 784, durationMs: 170, gain: 0.16, pauseAfterMs: 70 },
      { frequency: 988, durationMs: 190, gain: 0.18, pauseAfterMs: 70 },
      { frequency: 1318, durationMs: 230, gain: 0.22, pauseAfterMs: 90 },
      { frequency: 1568, durationMs: 320, gain: 0.24 },
    ],
    repeatCount: 2,
    repeatGapMs: 1250,
  },
  break_complete: {
    pattern: [
      { frequency: 659, durationMs: 220, gain: 0.16, pauseAfterMs: 70 },
      { frequency: 659, durationMs: 220, gain: 0.18, pauseAfterMs: 90 },
      { frequency: 1046, durationMs: 360, gain: 0.22 },
    ],
    repeatCount: 2,
    repeatGapMs: 1150,
  },
}

let sharedAudioContext: AudioContext | null = null

export function getPhaseAlertPattern(kind: PhaseAlertKind): readonly PhaseAlertStep[] {
  return getPhaseAlertPreset(kind).pattern
}

export function getPhaseAlertPreset(kind: PhaseAlertKind): PhaseAlertPreset {
  return phaseAlertPresets[kind]
}

export async function primePhaseAlertSound(): Promise<void> {
  try {
    const audioContext = getAudioContext()
    if (!audioContext || audioContext.state !== 'suspended') {
      return
    }
    await audioContext.resume()
  } catch (error) {
    console.warn('primePhaseAlertSound failed', error)
  }
}

export async function playPhaseAlertSound(kind: PhaseAlertKind): Promise<void> {
  try {
    const audioContext = getAudioContext()
    if (!audioContext) {
      return
    }
    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }
    if (audioContext.state !== 'running') {
      return
    }
    scheduleAlertSequence(audioContext, getPhaseAlertPreset(kind))
  } catch (error) {
    console.warn('playPhaseAlertSound failed', error)
  }
}

function getAudioContext(): AudioContext | null {
  if (sharedAudioContext?.state === 'closed') {
    sharedAudioContext = null
  }
  if (sharedAudioContext) {
    return sharedAudioContext
  }

  const AudioContextClass = resolveAudioContextConstructor()
  if (!AudioContextClass) {
    return null
  }

  sharedAudioContext = new AudioContextClass()
  return sharedAudioContext
}

function resolveAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') {
    return null
  }
  const audioGlobal = globalThis as typeof globalThis & {
    AudioContext?: AudioContextConstructor
    webkitAudioContext?: AudioContextConstructor
  }
  return audioGlobal.AudioContext ?? audioGlobal.webkitAudioContext ?? null
}

function scheduleAlertSequence(audioContext: AudioContext, preset: PhaseAlertPreset): void {
  let cursor = audioContext.currentTime + 0.01

  for (let index = 0; index < preset.repeatCount; index += 1) {
    cursor = scheduleAlertPattern(audioContext, preset.pattern, cursor)
    if (index < preset.repeatCount - 1) {
      cursor += preset.repeatGapMs / 1000
    }
  }
}

function scheduleAlertPattern(
  audioContext: AudioContext,
  pattern: readonly PhaseAlertStep[],
  startAt: number,
): number {
  let cursor = startAt

  for (const step of pattern) {
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()
    const durationSec = step.durationMs / 1000
    const endAt = cursor + durationSec
    const peakGain = clampAlertGain(step.gain)
    const attackEndAt = Math.min(cursor + 0.03, endAt)

    oscillator.type = 'triangle'
    oscillator.frequency.setValueAtTime(step.frequency, cursor)

    gainNode.gain.setValueAtTime(SILENT_GAIN, cursor)
    gainNode.gain.exponentialRampToValueAtTime(peakGain, attackEndAt)
    gainNode.gain.exponentialRampToValueAtTime(SILENT_GAIN, endAt)

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)

    oscillator.addEventListener(
      'ended',
      () => {
        oscillator.disconnect()
        gainNode.disconnect()
      },
      { once: true },
    )

    oscillator.start(cursor)
    oscillator.stop(endAt + 0.01)
    cursor = endAt + (step.pauseAfterMs ?? 0) / 1000
  }

  return cursor
}

function clampAlertGain(gain: number): number {
  return Math.min(Math.max(gain, SILENT_GAIN * 2), MAX_ALERT_GAIN)
}
