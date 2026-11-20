// Web Audio API emergency sounds synthesizer and Natural Web Speech API helper

class EmergencyAudioManager {
  private ctx: AudioContext | null = null;

  private getAudioContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  // Realistic European 425Hz Dial Tone (Freizeichenton)
  playDialTone(durationMs = 2500): () => void {
    try {
      const ctx = this.getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(425, ctx.currentTime);

      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + durationMs / 1000);

      return () => {
        try {
          osc.stop();
          osc.disconnect();
        } catch {
          // ignore if already stopped
        }
      };
    } catch {
      return () => {};
    }
  }

  // Realistic Ringing Tone
  startRinging(): () => void {
    try {
      const ctx = this.getAudioContext();

      const playRingBurst = () => {
        try {
          const osc1 = ctx.createOscillator();
          const osc2 = ctx.createOscillator();
          const gain = ctx.createGain();

          osc1.type = 'sine';
          osc1.frequency.setValueAtTime(425, ctx.currentTime);
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(450, ctx.currentTime);

          gain.gain.setValueAtTime(0.1, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);

          osc1.connect(gain);
          osc2.connect(gain);
          gain.connect(ctx.destination);

          osc1.start();
          osc2.start();
          osc1.stop(ctx.currentTime + 1.2);
          osc2.stop(ctx.currentTime + 1.2);
        } catch {
          // ignore
        }
      };

      playRingBurst();
      const intervalId = window.setInterval(playRingBurst, 2000);

      return () => {
        clearInterval(intervalId);
      };
    } catch {
      return () => {};
    }
  }

  // Radio Connect Beep (Funk-Roger-Beep / Leitstellenverbindung)
  playRadioBeep() {
    try {
      const ctx = this.getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1200, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch {
      // ignore
    }
  }

  // Subtle BOS Radio Transmission Click
  playRadioTransmissionClick() {
    try {
      const ctx = this.getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(950, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.05);

      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.06);
    } catch {
      // ignore
    }
  }

  // German Fire Department Alarm Gong (ZVEI 5-Tonfolge / Zweiklang-Alarmgong)
  playAlarmGong() {
    try {
      const ctx = this.getAudioContext();
      const frequencies = [850, 1060, 1330, 1660];
      const stepDuration = 0.08;

      frequencies.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * stepDuration);

        gain.gain.setValueAtTime(0.14, ctx.currentTime + idx * stepDuration);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (idx + 1) * stepDuration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + idx * stepDuration);
        osc.stop(ctx.currentTime + (idx + 1) * stepDuration);
      });

      // Big resonant double gong after the sequence
      setTimeout(() => {
        try {
          const gong1 = ctx.createOscillator();
          const gongGain1 = ctx.createGain();
          gong1.type = 'sine';
          gong1.frequency.setValueAtTime(520, ctx.currentTime);
          gongGain1.gain.setValueAtTime(0.22, ctx.currentTime);
          gongGain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.4);
          gong1.connect(gongGain1);
          gongGain1.connect(ctx.destination);
          gong1.start();
          gong1.stop(ctx.currentTime + 1.4);

          setTimeout(() => {
            const gong2 = ctx.createOscillator();
            const gongGain2 = ctx.createGain();
            gong2.type = 'sine';
            gong2.frequency.setValueAtTime(680, ctx.currentTime);
            gongGain2.gain.setValueAtTime(0.18, ctx.currentTime);
            gongGain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.6);
            gong2.connect(gongGain2);
            gongGain2.connect(ctx.destination);
            gong2.start();
            gong2.stop(ctx.currentTime + 1.6);
          }, 350);
        } catch {
          // ignore
        }
      }, frequencies.length * stepDuration * 1000);
    } catch {
      // ignore
    }
  }

  // Hang-up tone (Besetztzeichen)
  playHangupTone() {
    try {
      const ctx = this.getAudioContext();
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(425, ctx.currentTime + i * 0.4);
        gain.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.4);
        gain.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.4 + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.4);
        osc.stop(ctx.currentTime + i * 0.4 + 0.2);
      }
    } catch {
      // ignore
    }
  }
}

export const audioManager = new EmergencyAudioManager();

// Cache available voices
let cachedVoices: SpeechSynthesisVoice[] = [];
function loadVoices() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    cachedVoices = window.speechSynthesis.getVoices();
  }
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    loadVoices();
  };
}

// Find the most realistic, natural German dispatcher voice
function getBestGermanVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = cachedVoices.length > 0 ? cachedVoices : window.speechSynthesis.getVoices();
  const germanVoices = voices.filter(v => v.lang.startsWith('de') || v.lang.includes('DE'));
  if (germanVoices.length === 0) return null;

  // Preference hierarchy for ultra-realistic neural German voices
  const preferred = germanVoices.find(v =>
    v.name.includes('Natural') ||
    v.name.includes('Google Deutsch') ||
    v.name.includes('Neural') ||
    v.name.includes('Stefan') ||
    v.name.includes('Conrad') ||
    v.name.includes('Katja') ||
    v.name.includes('Marlene') ||
    v.name.includes('Anna (Enhanced)') ||
    v.name.includes('Markus') ||
    v.name.includes('Yannick') ||
    v.name.includes('Petra')
  );

  return preferred || germanVoices[0];
}

// Speech Synthesis Helper with Natural Intonation for German Dispatcher
export function speakDispatcherText(
  text: string,
  onStart?: () => void,
  onEnd?: () => void
): () => void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return () => {};
  }

  window.speechSynthesis.cancel();

  // Clean text of markdown, asterisks, brackets, or code artifacts for smooth, human pronunciation
  const cleanText = text
    .replace(/[*_#`~]/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/(\d+)\.\s/g, '$1, ') // Natural pauses for numbers
    .trim();

  if (!cleanText) {
    if (onEnd) onEnd();
    return () => {};
  }

  // Play subtle radio opening beep
  audioManager.playRadioTransmissionClick();

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = 'de-DE';
  utterance.rate = 1.25; // Schnelleres, dynamisches und professionelles Leitstellen-Sprechtempo
  utterance.pitch = 0.98; // Authoritative, steady Leitstellen pitch
  utterance.volume = 1.0;

  const bestVoice = getBestGermanVoice();
  if (bestVoice) {
    utterance.voice = bestVoice;
  }

  let hasEnded = false;
  const finish = () => {
    if (!hasEnded) {
      hasEnded = true;
      audioManager.playRadioTransmissionClick();
      if (onEnd) onEnd();
    }
  };

  if (onStart) utterance.onstart = onStart;
  utterance.onend = finish;
  utterance.onerror = finish;

  window.speechSynthesis.speak(utterance);

  return () => {
    try {
      window.speechSynthesis.cancel();
      finish();
    } catch {
      // ignore
    }
  };
}

// Natural Neural Dispatcher Voice via Gemini TTS (/api/dispatcher/tts) with seamless Web Speech fallback
export function speakDispatcherNaturalVoice(
  text: string,
  onStart?: () => void,
  onEnd?: () => void
): () => void {
  let cancelled = false;
  let activeAudio: HTMLAudioElement | null = null;
  let fallbackStop: (() => void) | null = null;
  let finished = false;

  const complete = () => {
    if (!finished) {
      finished = true;
      audioManager.playRadioTransmissionClick();
      if (onEnd) onEnd();
    }
  };

  const triggerFallback = () => {
    if (cancelled || finished) return;
    fallbackStop = speakDispatcherText(text, onStart, complete);
  };

  const controller = new AbortController();
  const abortTimer = window.setTimeout(() => controller.abort(), 6000);

  (async () => {
    try {
      const res = await fetch('/api/dispatcher/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      clearTimeout(abortTimer);

      if (cancelled) return;
      if (!res.ok) {
        triggerFallback();
        return;
      }

      const data = await res.json();
      if (cancelled || !data?.audioBase64) {
        triggerFallback();
        return;
      }

      const audio = new Audio(`data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`);
      activeAudio = audio;

      audio.onplay = () => {
        if (!cancelled) {
          audioManager.playRadioTransmissionClick();
          if (onStart) onStart();
        }
      };

      audio.onended = () => {
        complete();
      };

      audio.onerror = () => {
        triggerFallback();
      };

      if (onStart) onStart();
      await audio.play();
    } catch {
      clearTimeout(abortTimer);
      triggerFallback();
    }
  })();

  return () => {
    cancelled = true;
    clearTimeout(abortTimer);
    try {
      controller.abort();
    } catch {
      // ignore
    }
    if (activeAudio) {
      try {
        activeAudio.pause();
        activeAudio.src = '';
      } catch {
        // ignore
      }
    }
    if (fallbackStop) {
      fallbackStop();
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    complete();
  };
}

