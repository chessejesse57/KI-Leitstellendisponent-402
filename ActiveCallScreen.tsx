import React, { useState, useEffect, useRef } from 'react';
import {
  PhoneOff,
  Send,
  Radio,
  Truck,
  AlertTriangle,
  Flame,
  CheckCircle2,
  Clock,
  Volume2,
  VolumeX,
  MapPin,
  Siren,
  HelpCircle,
  FileText,
  Droplets,
  ShieldAlert,
  Navigation,
  Mic,
  MicOff,
  Keyboard,
  Phone,
  Loader2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { ChatMessage, CommunicationMode, EmergencyEvaluation, DispatchedVehicle } from '../types';
import { audioManager, speakDispatcherText, speakDispatcherNaturalVoice } from '../utils/audio';

// Downsample arbitrary AudioContext sampleRate to 16000 Hz cleanly
function downsampleTo16k(input: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === 16000) return input;
  const ratio = sourceRate / 16000;
  const targetLen = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(targetLen);
  for (let i = 0; i < targetLen; i++) {
    const srcIdx = i * ratio;
    const lower = Math.floor(srcIdx);
    const upper = Math.min(input.length - 1, lower + 1);
    const frac = srcIdx - lower;
    output[i] = input[lower] * (1 - frac) + input[upper] * frac;
  }
  return output;
}

// Encode Float32 [-1, 1] samples into 16-bit little-endian PCM Base64
function float32ToPcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    view.setInt16(i * 2, int16, true);
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Decode Base64 24kHz 16-bit little-endian PCM into Float32Array
function decodePcm24kBase64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return float32;
}

interface ActiveCallScreenProps {
  initialScenario?: string;
  simulatedLocation: string;
  soundEnabled: boolean;
  communicationMode?: CommunicationMode;
  onToggleSound: () => void;
  onHangUp: (evaluation: EmergencyEvaluation | null, messages: ChatMessage[], durationSeconds: number) => void;
}

export const ActiveCallScreen: React.FC<ActiveCallScreenProps> = ({
  initialScenario,
  simulatedLocation,
  soundEnabled,
  communicationMode = 'chat',
  onToggleSound,
  onHangUp,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [callDuration, setCallDuration] = useState(0);
  const [isDispatcherSpeaking, setIsDispatcherSpeaking] = useState(false);
  const [isLoadingDispatcher, setIsLoadingDispatcher] = useState(false);

  // Live Voice Conversation states (Gemini 3.8 Live Real-Time WebSocket)
  const [isLiveConnecting, setIsLiveConnecting] = useState(communicationMode === 'voice');
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [liveUserTranscript, setLiveUserTranscript] = useState('');
  const [liveDispatcherTranscript, setLiveDispatcherTranscript] = useState('');
  const [micError, setMicError] = useState<string | null>(null);
  const [showFallbackKeyboard, setShowFallbackKeyboard] = useState(false);

  // Live evaluation state - location is ALWAYS in Kiel
  const [evaluation, setEvaluation] = useState<EmergencyEvaluation>({
    stichwort: 'NOTFALL - Erstaufnahme',
    alarmstufe: 1,
    dringlichkeit: 'HOCH',
    einsatzort: 'Straße in Kiel wird erfragt',
    stadt: 'Kiel',
    locationGeo: {
      lat: 54.3233,
      lng: 10.1228,
      city: 'Kiel',
      displayName: 'Kiel, Schleswig-Holstein',
      country: 'Deutschland',
    },
    lagebericht: 'Erstabfrage durch Leitstellendisponent Kiel läuft.',
    anruferHinweise: [],
    alarmierteEinheiten: [],
    alarmVollautomatischAusgeloest: false,
    naechsteFrage: 'An welcher Adresse oder Straße in Kiel befindet sich der Notfallort?',
    dispatcherAntwort: 'Notruf 112 – Feuerwehr und Rettungsdienst Kiel. An welcher Adresse oder Straße in Kiel befindet sich der Notfallort?',
    fiveW: {
      wo: { completed: false, text: 'Straße in Kiel wird erfragt', label: '1. Wo in Kiel?' },
      was: { completed: false, text: 'Wird erfragt', label: '2. Was ist passiert?' },
      wieViele: { completed: false, text: 'Wird erfragt', label: '3. Wie viele Verletzte?' },
      welcheGefahren: { completed: false, text: 'Wird erfragt', label: '4. Welche Gefahren?' },
      warten: { completed: false, text: 'Warten auf vollständige 5-W Erfassung', label: '5. Warten auf Rückfragen' },
    },
  });

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const stopSpeechRef = useRef<(() => void) | null>(null);
  const alarmPlayedRef = useRef<boolean>(false);

  // Refs for real-time Gemini Live WebSocket & Web Audio PCM streams (prevents stale closures)
  const isMountedRef = useRef<boolean>(true);
  const liveWsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const inputProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputGainNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeAudioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const lastMicUiUpdateRef = useRef<number>(0);

  const isMicMutedRef = useRef<boolean>(false);
  const isDispatcherSpeakingRef = useRef<boolean>(false);
  const isLoadingDispatcherRef = useRef<boolean>(false);
  const soundEnabledRef = useRef<boolean>(soundEnabled);

  // Call duration counter
  useEffect(() => {
    const timer = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Anfahrt dauert nur noch 1 Minute (60 Sekunden)
  const [totalArrivalDuration, setTotalArrivalDuration] = useState<number>(60);
  const [arrivalSecondsRemaining, setArrivalSecondsRemaining] = useState<number | null>(null);
  const [isArrivalComplete, setIsArrivalComplete] = useState<boolean>(false);
  const [isEndingCallAfterArrival, setIsEndingCallAfterArrival] = useState<boolean>(false);
  const hasArrivedTriggeredRef = useRef<boolean>(false);
  const isArrivalCompleteRef = useRef<boolean>(false);
  const arrivalSecondsRemainingRef = useRef<number | null>(arrivalSecondsRemaining);
  const latestEvaluationRef = useRef<EmergencyEvaluation>(evaluation);
  const latestMessagesRef = useRef<ChatMessage[]>(messages);
  const callDurationRef = useRef<number>(callDuration);

  // Live calculated progress percentage (0 - 100%)
  const progressPercent = isArrivalComplete
    ? 100
    : arrivalSecondsRemaining !== null && totalArrivalDuration > 0
    ? Math.min(100, Math.max(0, Math.round(((totalArrivalDuration - arrivalSecondsRemaining) / totalArrivalDuration) * 100)))
    : 0;

  useEffect(() => {
    latestEvaluationRef.current = evaluation;
  }, [evaluation]);

  useEffect(() => {
    latestMessagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    callDurationRef.current = callDuration;
  }, [callDuration]);

  useEffect(() => {
    arrivalSecondsRemainingRef.current = arrivalSecondsRemaining;
  }, [arrivalSecondsRemaining]);

  useEffect(() => {
    isMicMutedRef.current = isMicMuted;
  }, [isMicMuted]);

  useEffect(() => {
    isDispatcherSpeakingRef.current = isDispatcherSpeaking;
  }, [isDispatcherSpeaking]);

  useEffect(() => {
    isLoadingDispatcherRef.current = isLoadingDispatcher;
  }, [isLoadingDispatcher]);

  useEffect(() => {
    isArrivalCompleteRef.current = isArrivalComplete;
  }, [isArrivalComplete]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
    if (outputGainNodeRef.current) {
      outputGainNodeRef.current.gain.value = soundEnabled ? 1 : 0;
    }
    if (soundEnabled && outputAudioCtxRef.current?.state === 'suspended') {
      void outputAudioCtxRef.current.resume();
    }
  }, [soundEnabled]);

  // Handle emergency units arriving on scene
  const handleUnitsArrived = () => {
    if (hasArrivedTriggeredRef.current) return;
    hasArrivedTriggeredRef.current = true;
    setIsArrivalComplete(true);
    setIsEndingCallAfterArrival(true);

    cleanupLiveCallResources();

    const arrivalText = 'Leitstelle an Anrufer: Die Einsatzkräfte sind jetzt direkt vor Ort eingetroffen und übernehmen die Lage. Ich beende hiermit das Notrufgespräch. Alles Gute und auf Wiederhören!';

    setEvaluation((prev) => {
      const updatedUnits: DispatchedVehicle[] = prev.alarmierteEinheiten.map((u) => ({
        ...u,
        status: 'EINSATZORT',
        statusText: 'Status 4 - Am Einsatzort eingetroffen',
        etaMinutes: 0,
      }));
      const updatedEval = { ...prev, alarmierteEinheiten: updatedUnits };
      latestEvaluationRef.current = updatedEval;
      return updatedEval;
    });

    const arrivalMsg: ChatMessage = {
      id: `msg-${Date.now() + 100}`,
      sender: 'dispatcher',
      text: arrivalText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => {
      const nextMsgs = [...prev, arrivalMsg];
      latestMessagesRef.current = nextMsgs;
      return nextMsgs;
    });

    if (soundEnabledRef.current) {
      audioManager.playRadioTransmissionClick();
      if (stopSpeechRef.current) {
        stopSpeechRef.current();
      }
      const speakFn = communicationMode === 'voice' ? speakDispatcherNaturalVoice : speakDispatcherText;
      stopSpeechRef.current = speakFn(
        arrivalText,
        () => {
          isDispatcherSpeakingRef.current = true;
          setIsDispatcherSpeaking(true);
        },
        () => {
          isDispatcherSpeakingRef.current = false;
          setIsDispatcherSpeaking(false);
        }
      );
    }

    // After announcement, automatically hang up and show mission summary
    setTimeout(() => {
      if (soundEnabledRef.current) {
        audioManager.playHangupTone();
      }
      cleanupLiveCallResources();
      onHangUp(latestEvaluationRef.current, latestMessagesRef.current, callDurationRef.current);
    }, 4500);
  };

  // Stop all currently queued 24kHz PCM playback chunks (on interruption/barge-in or hangup)
  const stopAllOutputAudio = () => {
    activeAudioSourcesRef.current.forEach((src) => {
      try {
        src.onended = null;
        src.stop();
      } catch {
        // ignore
      }
    });
    activeAudioSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    isDispatcherSpeakingRef.current = false;
    setIsDispatcherSpeaking(false);
  };

  // Schedule a 24kHz 16-bit PCM base64 audio chunk gaplessly
  const enqueuePcm24kAudioChunk = (base64Pcm: string) => {
    const outCtx = outputAudioCtxRef.current;
    const outGain = outputGainNodeRef.current;
    if (!outCtx || !outGain || !isMountedRef.current) return;

    if (outCtx.state === 'suspended') {
      void outCtx.resume();
    }

    const float32 = decodePcm24kBase64ToFloat32(base64Pcm);
    if (float32.length === 0) return;

    const buffer = outCtx.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);

    const startTime = Math.max(outCtx.currentTime, nextStartTimeRef.current);
    const source = outCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(outGain);

    activeAudioSourcesRef.current.add(source);
    source.onended = () => {
      activeAudioSourcesRef.current.delete(source);
      if (activeAudioSourcesRef.current.size === 0 && isMountedRef.current) {
        isDispatcherSpeakingRef.current = false;
        setIsDispatcherSpeaking(false);
      }
    };

    source.start(startTime);
    nextStartTimeRef.current = startTime + buffer.duration;
    isDispatcherSpeakingRef.current = true;
    setIsDispatcherSpeaking(true);
  };

  // Cleanup WebSocket, 16kHz input AudioContext, 24kHz output AudioContext, and mic tracks
  const cleanupLiveCallResources = () => {
    stopAllOutputAudio();

    if (liveWsRef.current) {
      try {
        liveWsRef.current.onopen = null;
        liveWsRef.current.onmessage = null;
        liveWsRef.current.onerror = null;
        liveWsRef.current.onclose = null;
        liveWsRef.current.close();
      } catch {
        // ignore
      }
      liveWsRef.current = null;
    }

    if (inputProcessorRef.current) {
      try {
        inputProcessorRef.current.onaudioprocess = null;
        inputProcessorRef.current.disconnect();
      } catch {
        // ignore
      }
      inputProcessorRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // ignore
        }
      });
      mediaStreamRef.current = null;
    }

    if (inputAudioCtxRef.current) {
      try {
        void inputAudioCtxRef.current.close();
      } catch {
        // ignore
      }
      inputAudioCtxRef.current = null;
    }

    if (outputAudioCtxRef.current) {
      try {
        void outputAudioCtxRef.current.close();
      } catch {
        // ignore
      }
      outputAudioCtxRef.current = null;
      outputGainNodeRef.current = null;
    }

    setIsListening(false);
    setIsLiveConnected(false);
    setIsLiveConnecting(false);
    setMicLevel(0);
    setLiveUserTranscript('');
    setLiveDispatcherTranscript('');
  };

  // Helper to apply evaluation updates from server (5-W, Kiel geocode, AAO dispatch & 1-min ETA timer)
  const applyServerEvaluation = (data: EmergencyEvaluation) => {
    latestEvaluationRef.current = data;
    setEvaluation(data);

    if (data.alarmVollautomatischAusgeloest || (data.alarmierteEinheiten && data.alarmierteEinheiten.length > 0)) {
      if (!alarmPlayedRef.current && soundEnabledRef.current) {
        alarmPlayedRef.current = true;
        audioManager.playAlarmGong();
      }
      if (arrivalSecondsRemainingRef.current === null) {
        const targetEtaSec = 60;
        arrivalSecondsRemainingRef.current = targetEtaSec;
        setTotalArrivalDuration(targetEtaSec);
        setArrivalSecondsRemaining(targetEtaSec);
      }
    }
  };

  // Start Gemini 3.8 Live Real-Time Phone Session
  const startGeminiLiveSession = async () => {
    try {
      setIsLiveConnecting(true);
      setMicError(null);

      // 1. Acquire microphone with hardware echo cancellation for natural barge-in
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });

      if (!isMountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      mediaStreamRef.current = stream;

      // 2. Setup 16kHz Input AudioContext + 24kHz Output AudioContext
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const inCtx = new AudioCtx({ sampleRate: 16000 });
      const outCtx = new AudioCtx({ sampleRate: 24000 });
      if (inCtx.state === 'suspended') await inCtx.resume();
      if (outCtx.state === 'suspended') await outCtx.resume();

      const outGain = outCtx.createGain();
      outGain.gain.value = soundEnabledRef.current ? 1 : 0;
      outGain.connect(outCtx.destination);

      inputAudioCtxRef.current = inCtx;
      outputAudioCtxRef.current = outCtx;
      outputGainNodeRef.current = outGain;
      nextStartTimeRef.current = 0;

      // 3. Connect WebSocket to /api/live-call
      const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${wsProtocol}://${window.location.host}/api/live-call`);
      liveWsRef.current = ws;

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return;
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'ready') {
            setIsLiveConnecting(false);
            setIsLiveConnected(true);
            setIsListening(true);

            // Start 16kHz PCM mic streaming to Gemini Live
            const source = inCtx.createMediaStreamSource(stream);
            const processor = inCtx.createScriptProcessor(2048, 1, 1);
            const silentSink = inCtx.createGain();
            silentSink.gain.value = 0;

            processor.onaudioprocess = (e) => {
              if (!isMountedRef.current || isMicMutedRef.current || isArrivalCompleteRef.current) {
                return;
              }
              if (!liveWsRef.current || liveWsRef.current.readyState !== WebSocket.OPEN) {
                return;
              }
              const rawSamples = e.inputBuffer.getChannelData(0);

              // Update voice orb amplitude smoothly (~8 fps)
              const now = performance.now();
              if (now - lastMicUiUpdateRef.current > 80) {
                lastMicUiUpdateRef.current = now;
                let sumSq = 0;
                for (let i = 0; i < rawSamples.length; i++) {
                  sumSq += rawSamples[i] * rawSamples[i];
                }
                const rms = Math.sqrt(sumSq / rawSamples.length);
                setMicLevel(Math.min(100, Math.round(rms * 450)));
              }

              const pcm16k = downsampleTo16k(rawSamples, inCtx.sampleRate);
              const base64Audio = float32ToPcm16Base64(pcm16k);
              liveWsRef.current.send(JSON.stringify({ type: 'audio', data: base64Audio }));
            };

            source.connect(processor);
            processor.connect(silentSink);
            silentSink.connect(inCtx.destination);
            inputProcessorRef.current = processor;

            // Trigger immediate dispatcher greeting (or initial scenario)
            ws.send(JSON.stringify({ type: 'start', initialScenario: initialScenario || '' }));
          } else if (msg.type === 'audio' && typeof msg.data === 'string') {
            enqueuePcm24kAudioChunk(msg.data);
          } else if (msg.type === 'input_transcript_interim' || msg.type === 'input_transcript') {
            setLiveUserTranscript(msg.text || '');
          } else if (msg.type === 'user_turn_final' && typeof msg.text === 'string') {
            setLiveUserTranscript('');
            const userMsg: ChatMessage = {
              id: `msg-u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              sender: 'user',
              text: msg.text,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            };
            const nextMsgs = [...latestMessagesRef.current, userMsg];
            latestMessagesRef.current = nextMsgs;
            setMessages(nextMsgs);
          } else if (msg.type === 'output_transcript') {
            setLiveDispatcherTranscript(msg.text || '');
          } else if (msg.type === 'dispatcher_turn_final' && typeof msg.text === 'string') {
            setLiveDispatcherTranscript('');
            const dispMsg: ChatMessage = {
              id: `msg-d-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              sender: 'dispatcher',
              text: msg.text,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            };
            const nextMsgs = [...latestMessagesRef.current, dispMsg];
            latestMessagesRef.current = nextMsgs;
            setMessages(nextMsgs);
          } else if (msg.type === 'interrupted') {
            stopAllOutputAudio();
            setLiveDispatcherTranscript('');
          } else if (msg.type === 'evaluation' && msg.evaluation) {
            applyServerEvaluation(msg.evaluation as EmergencyEvaluation);
          } else if (msg.type === 'error') {
            setIsLiveConnecting(false);
            setMicError(msg.message || 'Fehler in der Echtzeit-Sprachverbindung.');
            setShowFallbackKeyboard(true);
          } else if (msg.type === 'closed') {
            setIsLiveConnected(false);
            setIsListening(false);
          }
        } catch (parseErr) {
          console.warn('WebSocket message handling error:', parseErr);
        }
      };

      ws.onerror = () => {
        if (!isMountedRef.current) return;
        setIsLiveConnecting(false);
        setIsLiveConnected(false);
        setMicError('Live-Sprachleitung konnte nicht erreicht werden. Du kannst unten auch per Tastatur schreiben.');
        setShowFallbackKeyboard(true);
      };

      ws.onclose = () => {
        if (!isMountedRef.current) return;
        setIsLiveConnected(false);
        setIsListening(false);
      };
    } catch (err: any) {
      console.warn('Microphone / Live session error:', err);
      if (!isMountedRef.current) return;
      setIsLiveConnecting(false);
      setIsListening(false);
      setMicError('Kein Zugriff auf das Mikrofon möglich. Bitte erlaube das Mikrofon im Browser oder nutze unten die Tastatur.');
      setShowFallbackKeyboard(true);
    }
  };

  // Toggle Microphone Mute / Unmute in live voice mode
  const handleToggleMicMute = () => {
    setIsMicMuted((prev) => {
      const next = !prev;
      isMicMutedRef.current = next;
      if (next) setMicLevel(0);
      return next;
    });
  };

  // Interrupt dispatcher (instant barge-in)
  const handleInterruptAndSpeak = () => {
    stopAllOutputAudio();
    setLiveDispatcherTranscript('');
    setIsMicMuted(false);
    isMicMutedRef.current = false;
  };

  // ETA countdown interval (1 Minute / 60 Sekunden)
  useEffect(() => {
    if (arrivalSecondsRemaining === null || isArrivalComplete) return;

    const countdownInterval = setInterval(() => {
      setArrivalSecondsRemaining((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearInterval(countdownInterval);
          handleUnitsArrived();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, [arrivalSecondsRemaining, isArrivalComplete]);

  // Initial call startup
  useEffect(() => {
    isMountedRef.current = true;
    audioManager.playRadioTransmissionClick();

    if (communicationMode === 'voice') {
      // Connect immediately to Gemini 3.8 Live for zero-latency conversation
      void startGeminiLiveSession();
    } else {
      const initialDispatcherGreeting =
        'Notruf 112 – Feuerwehr und Rettungsdienst Kiel. An welcher Adresse oder Straße in Kiel befindet sich der Notfallort?';

      const greetingMsg: ChatMessage = {
        id: 'msg-greeting',
        sender: 'dispatcher',
        text: initialDispatcherGreeting,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      latestMessagesRef.current = [greetingMsg];
      setMessages([greetingMsg]);

      if (soundEnabled) {
        setTimeout(() => {
          if (!isMountedRef.current) return;
          if (stopSpeechRef.current) stopSpeechRef.current();
          stopSpeechRef.current = speakDispatcherText(
            initialDispatcherGreeting,
            () => {
              if (!isMountedRef.current) return;
              isDispatcherSpeakingRef.current = true;
              setIsDispatcherSpeaking(true);
            },
            () => {
              if (!isMountedRef.current) return;
              isDispatcherSpeakingRef.current = false;
              setIsDispatcherSpeaking(false);
            }
          );
        }, 350);
      }
      if (initialScenario) {
        setTimeout(() => {
          if (!isMountedRef.current) return;
          void handleSendMessage(initialScenario);
        }, 900);
      }
    }

    return () => {
      isMountedRef.current = false;
      if (stopSpeechRef.current) {
        stopSpeechRef.current();
      }
      cleanupLiveCallResources();
    };
  }, []);

  // Auto-scroll chat to bottom whenever messages or live streaming captions update
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isDispatcherSpeaking, isLoadingDispatcher, liveUserTranscript, liveDispatcherTranscript]);

  // Handle virtual keyboard reset on mobile/resize
  useEffect(() => {
    const handleScrollReset = () => {
      setTimeout(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
        if (chatScrollRef.current) {
          chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
      }, 100);
    };

    window.addEventListener('resize', handleScrollReset);
    return () => {
      window.removeEventListener('resize', handleScrollReset);
    };
  }, []);

  // Send message to AI Dispatcher (Chat Mode OR fallback keyboard inside Live Voice Mode)
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text) return;

    setInputText('');

    // If Live WebSocket is active in voice mode, send straight into the Live conversation!
    if (communicationMode === 'voice' && liveWsRef.current && liveWsRef.current.readyState === WebSocket.OPEN) {
      liveWsRef.current.send(JSON.stringify({ type: 'text', text }));
      return;
    }

    if (stopSpeechRef.current) {
      stopSpeechRef.current();
    }
    isDispatcherSpeakingRef.current = false;
    setIsDispatcherSpeaking(false);

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const newMessages = [...latestMessagesRef.current, userMsg];
    latestMessagesRef.current = newMessages;
    setMessages(newMessages);
    isLoadingDispatcherRef.current = true;
    setIsLoadingDispatcher(true);

    try {
      const res = await fetch('/api/dispatcher/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          userLocation: simulatedLocation,
        }),
      });

      if (!res.ok) {
        throw new Error('Server returned error');
      }

      const data: EmergencyEvaluation = await res.json();
      applyServerEvaluation(data);

      const dispatcherMsg: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        sender: 'dispatcher',
        text: data.dispatcherAntwort,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      const nextList = [...latestMessagesRef.current, dispatcherMsg];
      latestMessagesRef.current = nextList;
      setMessages(nextList);

      isLoadingDispatcherRef.current = false;
      setIsLoadingDispatcher(false);

      if (soundEnabledRef.current) {
        const speakFn = communicationMode === 'voice' ? speakDispatcherNaturalVoice : speakDispatcherText;
        stopSpeechRef.current = speakFn(
          data.dispatcherAntwort,
          () => {
            if (!isMountedRef.current) return;
            isDispatcherSpeakingRef.current = true;
            setIsDispatcherSpeaking(true);
          },
          () => {
            if (!isMountedRef.current) return;
            isDispatcherSpeakingRef.current = false;
            setIsDispatcherSpeaking(false);
          }
        );
      }
    } catch (err) {
      console.error('Failed to get dispatcher answer:', err);
      const fallbackReply = 'Leitstelle 112 verstanden. Wo genau ist der Notfallort (Straße und Hausnummer in Kiel)?';
      const dispatcherMsg: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        sender: 'dispatcher',
        text: fallbackReply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      const nextList = [...latestMessagesRef.current, dispatcherMsg];
      latestMessagesRef.current = nextList;
      setMessages(nextList);
      isLoadingDispatcherRef.current = false;
      setIsLoadingDispatcher(false);
      if (soundEnabledRef.current) {
        stopSpeechRef.current = speakDispatcherText(fallbackReply);
      }
    }
  };

  const formatCountdown = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const getVehicleIcon = (iconType: string) => {
    switch (iconType) {
      case 'ladder':
        return <Flame className="w-4 h-4 text-amber-500" />;
      case 'ambulance':
        return <Siren className="w-4 h-4 text-rose-500" />;
      case 'command':
        return <Radio className="w-4 h-4 text-indigo-500" />;
      case 'rescue':
        return <ShieldAlert className="w-4 h-4 text-orange-500" />;
      case 'tank':
        return <Droplets className="w-4 h-4 text-blue-500" />;
      default:
        return <Truck className="w-4 h-4 text-red-500" />;
    }
  };

  return (
    <div id="active-call-root" className="min-h-screen bg-slate-100 text-slate-900 flex flex-col justify-between selection:bg-red-200">
      {/* Live Emergency Units Arrival Progress Monitor Banner (1 Minute Countdown) */}
      {(arrivalSecondsRemaining !== null || isArrivalComplete) && (
        <section
          id="arrival-live-progress-monitor"
          aria-label="Anfahrtsstatus der Einsatzkräfte"
          className="bg-slate-900 border-b border-slate-800 text-white px-4 py-3 sm:px-6 shadow-inner"
        >
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-2.5">
              <div className="flex items-center gap-2.5">
                <div className="relative flex items-center justify-center">
                  <span className={`w-3.5 h-3.5 rounded-full ${isArrivalComplete ? 'bg-emerald-500' : 'bg-red-600'} relative`}></span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black uppercase tracking-wider text-red-400 flex items-center gap-1">
                      <Siren className="w-3.5 h-3.5" />
                      <span>{isArrivalComplete ? 'Status 4: Vor Ort' : 'Live-Anfahrt (1 Minute)'}</span>
                    </span>
                    <span className="text-[11px] font-semibold text-slate-300">
                      • {evaluation.stichwort || 'Einsatz'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-medium">
                    {progressPercent < 25 && 'Phase 1: Alarmierung quittiert • Kräfte besetzen Fahrzeuge • Ausfahrt Wache'}
                    {progressPercent >= 25 && progressPercent < 70 && 'Phase 2: Auf Anfahrt mit Sondersignal (Blaulicht & Martinshorn)'}
                    {progressPercent >= 70 && progressPercent < 100 && 'Phase 3: Im Nahbereich • Einbiegen in Zielstraße'}
                    {progressPercent >= 100 && 'Phase 4: Status 4 • Alle Einsatzkräfte am Einsatzort eingetroffen'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 self-end sm:self-center">
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                    {isArrivalComplete ? 'Einsatzort erreicht' : 'Verbleibende Anfahrt (1 Min):'}
                  </div>
                  <div className="font-mono font-black text-sm sm:text-base text-amber-300 flex items-center justify-end gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span>{isArrivalComplete ? '00:00 (VOR ORT)' : formatCountdown(arrivalSecondsRemaining ?? 0)}</span>
                    <span className="text-xs font-normal text-slate-400 font-sans">({progressPercent}%)</span>
                  </div>
                </div>

                {!isArrivalComplete && arrivalSecondsRemaining !== null && arrivalSecondsRemaining > 8 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setArrivalSecondsRemaining(5)}
                      className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs sm:text-sm border-2 border-amber-300 shadow-md hover:shadow-amber-500/30 transition-all cursor-pointer flex items-center gap-1.5"
                      title="Test: Countdown direkt auf 5 Sekunden vor Ankunft vorspulen"
                    >
                      <span className="text-base">⏩</span>
                      <span>Zu 5 Sek. vor Ankunft skippen</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* The Animated Visual Progress Bar Track & Runner */}
            <div className="relative pt-2.5 pb-1">
              <div className="w-full h-4 bg-slate-800/90 rounded-full overflow-hidden border border-slate-700 relative p-0.5 shadow-inner">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out relative ${
                    isArrivalComplete
                      ? 'bg-linear-to-r from-emerald-500 to-teal-400'
                      : 'bg-linear-to-r from-amber-500 via-orange-500 to-red-600'
                  }`}
                  style={{ width: `${Math.max(3, progressPercent)}%` }}
                >
                </div>
              </div>

              {/* Dynamic Vehicle Pin Marker */}
              <div
                className="absolute -top-1 transition-all duration-700 ease-out pointer-events-none -translate-x-1/2"
                style={{ left: `${Math.max(3, Math.min(97, progressPercent))}%` }}
              >
                <div className="flex flex-col items-center">
                  <span className={`px-1.5 py-0.5 rounded-full text-white font-bold text-[9px] shadow-md border whitespace-nowrap flex items-center gap-1 ${
                    isArrivalComplete ? 'bg-emerald-600 border-emerald-400' : 'bg-red-600 border-red-400'
                  }`}>
                    <Truck className="w-2.5 h-2.5" />
                    <span>{progressPercent}%</span>
                  </span>
                  <div className={`w-1.5 h-1.5 rotate-45 -mt-0.5 ${isArrivalComplete ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                </div>
              </div>

              {/* Milestone Checkpoints */}
              <div className="flex justify-between items-center text-[10px] font-medium text-slate-400 mt-2.5 px-0.5">
                <div className={`flex items-center gap-1 ${progressPercent >= 0 ? 'text-amber-300 font-bold' : ''}`}>
                  <span className={`w-2 h-2 rounded-full ${progressPercent >= 0 ? 'bg-amber-400' : 'bg-slate-700'}`}></span>
                  <span>Alarmierung (0%)</span>
                </div>
                <div className={`flex items-center gap-1 hidden sm:flex ${progressPercent >= 25 ? 'text-amber-300 font-bold' : ''}`}>
                  <span className={`w-2 h-2 rounded-full ${progressPercent >= 25 ? 'bg-amber-400' : 'bg-slate-700'}`}></span>
                  <span>Ausgerückt (25%)</span>
                </div>
                <div className={`flex items-center gap-1 hidden sm:flex ${progressPercent >= 70 ? 'text-amber-300 font-bold' : ''}`}>
                  <span className={`w-2 h-2 rounded-full ${progressPercent >= 70 ? 'bg-amber-400' : 'bg-slate-700'}`}></span>
                  <span>Nahbereich (70%)</span>
                </div>
                <div className={`flex items-center gap-1 ${progressPercent >= 100 ? 'text-emerald-400 font-bold' : ''}`}>
                  <span className={`w-2 h-2 rounded-full ${progressPercent >= 100 ? 'bg-emerald-400' : 'bg-slate-700'}`}></span>
                  <span>Am Einsatzort (100%)</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Main 2-Column Responsive Dashboard (Karte entfernt per Nutzeranweisung; Anfahrt 1 Min) */}
      <div id="call-body-grid" className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* CHAT PANEL (lg:col-span-7) */}
        <section id="call-chat-panel" className="lg:col-span-7 flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          
          {/* Dispatcher Voice Active Visualizer Bar */}
          <div id="dispatcher-visualizer" className="bg-slate-900 text-white p-3.5 flex items-center justify-between border-b border-slate-800 shrink-0">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  isDispatcherSpeaking ? 'bg-red-600 ring-4 ring-red-500/40' : 'bg-slate-800'
                }`}>
                  <Radio className="w-5 h-5 text-white" />
                </div>
                {isDispatcherSpeaking && (
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-emerald-400 rounded-full border-2 border-slate-900"></span>
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white">
                    Leitstellen-Disponent 112 {communicationMode === 'voice' ? '• Live-Telefonat' : '• Text-Chat'}
                  </span>
                  {isDispatcherSpeaking ? (
                    <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-800 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                      Spricht...
                    </span>
                  ) : isLiveConnected && isListening && !isMicMuted ? (
                    <span className="text-[10px] font-semibold text-sky-400 bg-sky-950/80 px-2 py-0.5 rounded-full border border-sky-800 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"></span>
                      Echtzeit-Mikrofon aktiv
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400">Hört zu...</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 truncate max-w-xs">
                  {isLiveConnecting
                    ? 'Verbinde Echtzeit-Sprachleitung 112...'
                    : isLoadingDispatcher
                    ? 'Analysiert Notruf & disponiert...'
                    : communicationMode === 'voice' && isLiveConnected
                    ? 'Sofortige Echtzeit-Konversation (Gemini Live)'
                    : 'Gleichzeitige Alarmierungsüberwachung'}
                </p>
              </div>
            </div>

            {/* Audio Waveform Animation */}
            <div className="flex items-center gap-1 h-5">
              {[40, 75, 90, 60, 80, 45, 95, 50].map((h, i) => (
                <motion.div
                  key={i}
                  animate={{
                    height: isDispatcherSpeaking
                      ? [`${h * 0.2}%`, `${h}%`, `${h * 0.3}%`]
                      : isListening && !isMicMuted
                      ? `${Math.max(15, Math.min(100, micLevel * (0.6 + (i % 3) * 0.25)))}%`
                      : '15%',
                  }}
                  transition={{
                    repeat: isDispatcherSpeaking ? Infinity : 0,
                    duration: 0.6 + (i % 3) * 0.2,
                    ease: 'easeInOut',
                  }}
                  className={`w-1 rounded-full ${
                    isDispatcherSpeaking ? 'bg-red-500' : isListening && !isMicMuted ? 'bg-sky-400' : 'bg-slate-700'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Current Question / Focus Banner */}
          {evaluation.naechsteFrage && (
            <div className="bg-amber-50 border-b border-amber-200/80 px-4 py-2.5 flex items-start gap-2.5 text-amber-900 shrink-0">
              <HelpCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs">
                <span className="font-bold uppercase tracking-wider text-[10px] text-amber-700 block">
                  Wichtige Frage des Disponenten:
                </span>
                <span className="font-medium text-slate-900">{evaluation.naechsteFrage}</span>
              </div>
            </div>
          )}

          {/* GEMINI LIVE REAL-TIME VOICE CALL STUDIO (Voice Mode Only) */}
          {communicationMode === 'voice' && (
            <div
              id="voice-call-orb-panel"
              className="bg-linear-to-b from-slate-900 via-slate-900 to-slate-950 text-white px-4 py-4 border-b border-slate-800 flex flex-col items-center text-center relative overflow-hidden shrink-0"
            >
              {/* Soft background glow */}
              <div
                className={`absolute inset-0 pointer-events-none opacity-25 transition-colors duration-500 ${
                  isDispatcherSpeaking
                    ? 'bg-radial from-red-500/40 via-transparent to-transparent'
                    : isListening && !isMicMuted
                    ? 'bg-radial from-sky-500/40 via-transparent to-transparent'
                    : 'bg-radial from-slate-500/20 via-transparent to-transparent'
                }`}
              />

              {/* Interactive Glowing Voice Orb */}
              <div className="relative flex items-center justify-center my-1">
                {((isListening && !isMicMuted) || isDispatcherSpeaking) && (
                  <motion.div
                    animate={{
                      scale: isDispatcherSpeaking
                        ? [1, 1.28, 1.05]
                        : 1 + (micLevel / 100) * 0.48,
                      opacity: isDispatcherSpeaking ? [0.5, 0.15, 0.5] : 0.45,
                    }}
                    transition={
                      isDispatcherSpeaking
                        ? { repeat: Infinity, duration: 1.4, ease: 'easeInOut' }
                        : { duration: 0.08 }
                    }
                    className={`absolute w-24 h-24 sm:w-28 sm:h-28 rounded-full ${
                      isDispatcherSpeaking
                        ? 'bg-red-500/40 blur-xs'
                        : 'bg-sky-400/40 blur-xs'
                    }`}
                  />
                )}

                <button
                  type="button"
                  onClick={() => {
                    if (isDispatcherSpeaking) {
                      handleInterruptAndSpeak();
                    } else {
                      handleToggleMicMute();
                    }
                  }}
                  className={`relative z-10 w-20 h-20 sm:w-22 sm:h-22 rounded-full flex items-center justify-center shadow-2xl border-2 transition-all cursor-pointer ${
                    isLiveConnecting
                      ? 'bg-linear-to-br from-amber-500 to-orange-600 border-amber-300 shadow-amber-900/40'
                      : isDispatcherSpeaking
                      ? 'bg-linear-to-br from-red-500 to-rose-700 border-red-300 shadow-red-900/50'
                      : isMicMuted
                      ? 'bg-slate-800 border-slate-600 text-slate-400 hover:bg-slate-700'
                      : isListening
                      ? 'bg-linear-to-br from-sky-400 via-blue-500 to-indigo-600 border-sky-200 shadow-sky-900/50'
                      : 'bg-slate-800 border-slate-600'
                  }`}
                  title={
                    isDispatcherSpeaking
                      ? 'Klicken zum Unterbrechen & Sprechen'
                      : isMicMuted
                      ? 'Mikrofon einschalten'
                      : 'Mikrofon stummschalten'
                  }
                >
                  {isLiveConnecting ? (
                    <Loader2 className="w-8 h-8 text-white animate-spin" />
                  ) : isDispatcherSpeaking ? (
                    <Phone className="w-8 h-8 text-white animate-pulse" />
                  ) : isMicMuted ? (
                    <MicOff className="w-8 h-8 text-slate-300" />
                  ) : (
                    <Mic className="w-8 h-8 text-white" />
                  )}
                </button>
              </div>

              {/* Status Label */}
              <div className="mt-2 z-10">
                <p className="text-xs sm:text-sm font-bold tracking-tight text-white">
                  {isLiveConnecting
                    ? 'Echtzeit-Sprachleitung 112 wird aufgebaut...'
                    : isDispatcherSpeaking
                    ? 'Disponent spricht live...'
                    : isMicMuted
                    ? 'Mikrofon stummgeschaltet'
                    : isListening
                    ? 'Echtzeit-Gespräch aktiv – sprich einfach ins Mikrofon'
                    : 'Telefonleitung 112 bereit'}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {isDispatcherSpeaking
                    ? 'Du kannst den Disponenten jederzeit direkt durch Sprechen unterbrechen.'
                    : isMicMuted
                    ? 'Tippe auf das Mikrofon, um weiterzusprechen.'
                    : 'Gesprochene Worte erscheinen sofort unten im Chatverlauf und der Disponent antwortet ohne Wartezeit.'}
                </p>
              </div>

              {micError && (
                <div className="mt-2.5 px-3 py-2 rounded-xl bg-red-950/80 border border-red-500/50 text-xs text-red-200 max-w-md w-full flex items-center gap-2 text-left z-10">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{micError}</span>
                </div>
              )}

              {/* Voice Control Buttons */}
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 z-10">
                <button
                  id="voice-mute-toggle-btn"
                  type="button"
                  onClick={handleToggleMicMute}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all cursor-pointer ${
                    isMicMuted
                      ? 'bg-red-600/20 border-red-500/50 text-red-200 hover:bg-red-600/30'
                      : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  {isMicMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-sky-400" />}
                  <span>{isMicMuted ? 'Mikrofon einschalten' : 'Stummschalten'}</span>
                </button>

                {isDispatcherSpeaking && (
                  <button
                    id="voice-interrupt-btn"
                    type="button"
                    onClick={handleInterruptAndSpeak}
                    className="px-3.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white border border-white/25 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Mic className="w-3.5 h-3.5 text-emerald-300" />
                    <span>Unterbrechen</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowFallbackKeyboard((prev) => !prev)}
                  className="px-2.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs flex items-center gap-1 cursor-pointer transition-colors"
                  title="Tastatur ein-/ausblenden"
                >
                  <Keyboard className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Tippen</span>
                </button>
              </div>
            </div>
          )}

          {/* Transcript Section Header in Voice Mode */}
          {communicationMode === 'voice' && (
            <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between text-[11px] font-bold text-slate-600 uppercase tracking-wider shrink-0">
              <span>Live-Konversation (Echtzeit-Text)</span>
              <span className="font-mono font-normal text-slate-500">{messages.length} Nachrichten</span>
            </div>
          )}

          {/* Conversation Transcript Stream (ALWAYS visible in both Voice and Chat mode!) */}
          <div
            ref={chatScrollRef}
            id="chat-messages-container"
            className={`flex-1 p-4 overflow-y-auto space-y-3.5 bg-slate-50/50 ${
              communicationMode === 'voice' ? 'min-h-[240px] max-h-[340px]' : 'min-h-[300px] max-h-[460px]'
            }`}
          >
            {messages.map((msg) => {
              const isDisp = msg.sender === 'dispatcher';
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex flex-col ${isDisp ? 'items-start' : 'items-end'}`}
                >
                  <div className="flex items-center gap-1.5 mb-1 px-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      {isDisp ? 'Feuerwehr-Disponent' : 'Sie (Anrufer)'}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">{msg.timestamp}</span>
                  </div>
                  <div
                    className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-xs sm:text-sm leading-relaxed shadow-2xs ${
                      isDisp
                        ? 'bg-white text-slate-900 border border-slate-200/90 rounded-tl-xs font-normal'
                        : 'bg-red-600 text-white rounded-tr-xs font-medium'
                    }`}
                  >
                    {msg.text}
                  </div>
                </motion.div>
              );
            })}

            {/* Live Caller Speech-to-Text Streaming Bubble inside the Conversation */}
            {liveUserTranscript && (
              <div className="flex flex-col items-end">
                <div className="flex items-center gap-1.5 mb-1 px-1">
                  <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse"></span>
                  <span className="text-[10px] font-bold text-sky-700 uppercase tracking-wider">
                    Sie (Anrufer) • Spricht live
                  </span>
                </div>
                <div className="max-w-[88%] rounded-2xl rounded-tr-xs px-4 py-2.5 text-xs sm:text-sm leading-relaxed bg-red-500/90 text-white border border-red-400 shadow-2xs italic">
                  {liveUserTranscript}
                </div>
              </div>
            )}

            {/* Live Dispatcher Voice-to-Text Streaming Bubble inside the Conversation */}
            {liveDispatcherTranscript && (
              <div className="flex flex-col items-start">
                <div className="flex items-center gap-1.5 mb-1 px-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
                    Feuerwehr-Disponent • Spricht live
                  </span>
                </div>
                <div className="max-w-[88%] rounded-2xl rounded-tl-xs px-4 py-2.5 text-xs sm:text-sm leading-relaxed bg-white text-slate-900 border border-emerald-300 shadow-2xs">
                  {liveDispatcherTranscript}
                </div>
              </div>
            )}

            {isEndingCallAfterArrival && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-3 rounded-xl bg-emerald-600 text-white font-bold text-xs flex items-center justify-between shadow-md"
              >
                <div className="flex items-center gap-2">
                  <Siren className="w-5 h-5 text-amber-300" />
                  <span>🚨 Einsatzkräfte sind am Einsatzort eingetroffen – Gespräch wird beendet...</span>
                </div>
                <CheckCircle2 className="w-4 h-4 text-emerald-200" />
              </motion.div>
            )}

            {isLoadingDispatcher && (
              <div className="flex items-center gap-2 text-xs text-slate-500 p-2">
                <span className="w-2 h-2 rounded-full bg-red-600 animate-ping"></span>
                <span>Disponent nimmt Meldung auf & disponiert...</span>
              </div>
            )}
          </div>

          {/* User Input Controls Area (Always visible in Chat Mode, optional fallback in Voice Mode) */}
          {(communicationMode === 'chat' || showFallbackKeyboard) && (
            <div id="call-input-controls" className="p-3 bg-white border-t border-slate-200 flex flex-col gap-2 shrink-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSendMessage();
                  (document.activeElement as HTMLElement)?.blur();
                  setTimeout(() => {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }, 120);
                }}
                className="flex items-center gap-2"
              >
                {/* Text Input */}
                <input
                  id="caller-text-input"
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onBlur={() => {
                    setTimeout(() => {
                      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
                      if (chatScrollRef.current) {
                        chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
                      }
                    }, 120);
                  }}
                  placeholder={
                    communicationMode === 'voice'
                      ? 'Alternativ Nachricht eintippen...'
                      : 'Situation schildern oder Einheiten nachalarmieren...'
                  }
                  className="flex-1 bg-slate-50 border border-slate-300 focus:border-red-500 focus:bg-white focus:outline-hidden rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 transition-all"
                />

                {/* Send Button */}
                <button
                  id="send-message-button"
                  type="submit"
                  disabled={!inputText.trim() || isLoadingDispatcher}
                  className="p-2.5 sm:p-3 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white flex items-center justify-center transition-all cursor-pointer shadow-xs"
                  title="Nachricht senden"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          )}

          {/* PROMINENT RED HANG UP BUTTON & CONTROLS */}
          <div id="hangup-action-bar" className="p-3 bg-slate-900 border-t border-slate-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onToggleSound}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors border ${
                  soundEnabled
                    ? 'bg-slate-800 text-emerald-400 border-slate-700 hover:bg-slate-700'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                }`}
                title={soundEnabled ? 'Sprachausgabe aktiv' : 'Stummgeschaltet'}
              >
                {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{soundEnabled ? 'Audio Ein' : 'Audio Aus'}</span>
              </button>

              <div className="flex items-center gap-1 text-slate-400 text-xs font-mono">
                <Clock className="w-3 h-3 text-slate-500" />
                <span>{formatTime(callDuration)}</span>
              </div>
            </div>

            <motion.button
              id="hangup-emergency-button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => {
                cleanupLiveCallResources();
                if (stopSpeechRef.current) stopSpeechRef.current();
                onHangUp(evaluation, messages, callDuration);
              }}
              className="px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-red-900/50 cursor-pointer transition-all border border-red-500"
            >
              <PhoneOff className="w-4 h-4" />
              <span>Auflegen & Zurück zur Hauptseite</span>
            </motion.button>
          </div>
        </section>

        {/* SIDE PANEL (lg:col-span-5): Live Alarm, 5-W Protocol & Entsendete Kräfte */}
        <section id="call-side-panel" className="lg:col-span-5 flex flex-col gap-3.5">
          
          {/* Automatic Alarm Banner */}
          <div
            id="alarm-dispatch-banner"
            className={`p-4 rounded-2xl border transition-all ${
              evaluation.alarmVollautomatischAusgeloest
                ? 'bg-linear-to-br from-red-600 to-red-800 text-white border-red-500 shadow-md shadow-red-900/20'
                : 'bg-white text-slate-900 border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Siren className={`w-5 h-5 ${evaluation.alarmVollautomatischAusgeloest ? 'text-amber-300' : 'text-slate-400'}`} />
                <span className="text-xs font-black uppercase tracking-wider">
                  {evaluation.alarmVollautomatischAusgeloest ? '🚨 VOLLAUTOMATISCH ALARMIERT' : 'Status: Lageerfassung'}
                </span>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                evaluation.alarmVollautomatischAusgeloest ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'
              }`}>
                Alarmstufe {evaluation.alarmstufe}
              </span>
            </div>

            <div className="font-extrabold text-base sm:text-lg tracking-tight mb-1">
              {evaluation.stichwort}
            </div>

            <div className="flex items-center gap-2 text-xs opacity-90">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Ort: <strong>{evaluation.einsatzort || simulatedLocation}</strong></span>
            </div>

            {/* Live Arrival Countdown Progress Bar (1 Minute) */}
            {arrivalSecondsRemaining !== null && (
              <div className="mt-3 pt-2.5 border-t border-white/20 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 font-bold text-amber-300">
                  <Clock className="w-3.5 h-3.5 text-amber-300" />
                  <span>Eintreffen in 1 Min:</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-black text-xs sm:text-sm px-2 py-0.5 rounded bg-black/40 text-amber-300 border border-amber-400/30">
                    {formatCountdown(arrivalSecondsRemaining)}
                  </span>
                  {arrivalSecondsRemaining > 8 && (
                    <button
                      type="button"
                      onClick={() => setArrivalSecondsRemaining(5)}
                      className="text-xs px-2.5 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-black cursor-pointer transition-all shadow-xs border border-amber-200 flex items-center gap-1"
                      title="Timer direkt auf 5 Sek vorspulen"
                    >
                      <span>⏩</span>
                      <span>Zu 5s skippen</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 5-W Schema Protocol Checklist */}
          <div id="five-w-checklist" className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 uppercase tracking-wider">
                <FileText className="w-4 h-4 text-red-600" />
                <span>5-W Notruf-Abfrageprotokoll</span>
              </div>
              <span className="text-[10px] font-semibold text-slate-500">
                {Object.values(evaluation.fiveW).filter((v: any) => v.completed).length} / 5 erfasst
              </span>
            </div>

            <div className="space-y-2">
              {Object.entries(evaluation.fiveW).map(([key, rawItem]) => {
                const item = rawItem as { completed: boolean; text: string; label: string };
                return (
                  <div
                    key={key}
                    className={`p-2 rounded-xl text-xs flex items-start gap-2.5 border transition-all ${
                      item.completed
                        ? 'bg-emerald-50/60 border-emerald-200 text-emerald-950'
                        : 'bg-slate-50 border-slate-200/60 text-slate-500'
                    }`}
                  >
                    <div className="mt-0.5">
                      {item.completed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-slate-300 shrink-0"></div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="font-bold text-xs">{item.label}</div>
                      <div className="text-[11px] mt-0.5 text-slate-600 font-medium">
                        {item.completed ? item.text : 'Wird vom Disponenten abgefragt...'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Dispatched Fire & Rescue Units List (only vehicle designations, e.g. HLF 20, RTW) */}
          <div id="dispatched-units-list" className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 uppercase tracking-wider">
                <Truck className="w-4 h-4 text-red-600" />
                <span>Entsendete Einsatzkräfte & Fahrzeuge</span>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-800">
                {evaluation.alarmierteEinheiten.length} Einheiten
              </span>
            </div>

            {/* Tactical Anfahrt Status Bar within the card */}
            {evaluation.alarmierteEinheiten.length > 0 && (arrivalSecondsRemaining !== null || isArrivalComplete) && (
              <div className="mb-3 p-2.5 rounded-xl bg-slate-900 text-white text-xs border border-slate-800">
                <div className="flex items-center justify-between mb-1.5 text-[11px]">
                  <span className="text-slate-300 font-semibold flex items-center gap-1">
                    <Navigation className="w-3 h-3 text-amber-400" />
                    <span>Anfahrts-Status (1 Min)</span>
                  </span>
                  <span className="font-mono text-amber-300 font-bold">
                    {isArrivalComplete ? 'VOR ORT' : `Noch ${formatCountdown(arrivalSecondsRemaining ?? 0)}`}
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                  <div
                    className={`h-full transition-all duration-700 ${
                      isArrivalComplete ? 'bg-emerald-500' : 'bg-linear-to-r from-amber-400 to-red-500'
                    }`}
                    style={{ width: `${Math.max(4, progressPercent)}%` }}
                  ></div>
                </div>
                <div className="flex justify-between items-center text-[10px] text-slate-400 mt-1 font-medium">
                  <span>Ziel: {evaluation.einsatzort || simulatedLocation}</span>
                  <span className="text-amber-300 font-semibold">{progressPercent}%</span>
                </div>
              </div>
            )}

            {evaluation.alarmierteEinheiten.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                Einsatzmittel werden nach vollständiger 5-W Abfrage alarmiert...
              </div>
            ) : (
              <div className="space-y-2 overflow-y-auto max-h-[300px] pr-1">
                {evaluation.alarmierteEinheiten.map((veh) => {
                  let dynamicStatus = veh.statusText;
                  if (isArrivalComplete || veh.status === 'EINSATZORT') {
                    dynamicStatus = 'Vor Ort';
                  } else if (progressPercent < 25) {
                    dynamicStatus = 'Ausgerückt';
                  } else if (progressPercent < 70) {
                    dynamicStatus = 'Auf Anfahrt';
                  } else {
                    dynamicStatus = 'Nahbereich';
                  }

                  return (
                    <motion.div
                      key={veh.id}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/80 hover:bg-slate-100/80 transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="p-2 rounded-lg bg-white border border-slate-200 shadow-2xs relative shrink-0">
                          {getVehicleIcon(veh.iconType)}
                          {veh.status === 'EINSATZORT' || isArrivalComplete ? (
                            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                          ) : (
                            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-sm text-slate-900">
                              {veh.type || veh.name}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className={`inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                          veh.status === 'EINSATZORT' || isArrivalComplete
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                            : 'bg-blue-100 text-blue-800 border-blue-200'
                        }`}>
                          {dynamicStatus}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
