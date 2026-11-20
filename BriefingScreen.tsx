import React, { useState, useEffect } from 'react';
import {
  Phone,
  ArrowRight,
  Radio,
  Compass,
  Award,
  AlertTriangle,
  Clock,
  Mic,
  MessageSquareText,
  CheckCircle2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { CommunicationMode } from '../types';

interface BriefingScreenProps {
  onConfirmCall: (mode: CommunicationMode) => void;
  onCancel: () => void;
  selectedScenario?: string;
  waitTimerEnabled?: boolean;
}

export const BriefingScreen: React.FC<BriefingScreenProps> = ({
  onConfirmCall,
  onCancel,
  selectedScenario,
  waitTimerEnabled = true,
}) => {
  // 15-Sekunden Sperre für das zweite Fenster (Einführung/Briefing), falls aktiviert
  const [secondsRemaining, setSecondsRemaining] = useState<number>(waitTimerEnabled ? 15 : 0);
  // Pflichtauswahl vor dem Notruf: Telefonieren oder Schreiben
  const [selectedMode, setSelectedMode] = useState<CommunicationMode | null>(null);

  useEffect(() => {
    if (!waitTimerEnabled) {
      setSecondsRemaining(0);
      return;
    }

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [waitTimerEnabled]);

  const isTimerLocked = waitTimerEnabled && secondsRemaining > 0;
  const isButtonDisabled = isTimerLocked || !selectedMode;

  return (
    <div id="briefing-screen-root" className="min-h-screen bg-slate-50 text-slate-800 flex flex-col justify-center items-center px-4 py-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-2xl bg-white rounded-3xl shadow-xl border border-slate-200/80 p-6 sm:p-8 relative overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-2xl bg-red-100 border border-red-200 flex items-center justify-center text-red-600">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              Einführung & Notruf-Modus
            </h2>
          </div>
        </div>

        {/* Intro Text */}
        <div className="mb-4 p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs sm:text-sm text-slate-700 leading-relaxed">
          <p>
            Du wirst gleich direkt mit dem <strong>KI</strong>-Disponenten der Feuerwehr und des Rettungsdienstes Kiel verbunden.
          </p>
          {selectedScenario && (
            <div className="mt-3 pt-3 border-t border-slate-200 flex items-start gap-2 text-slate-700">
              <Compass className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>
                <strong>Dein gewähltes Szenario:</strong> {selectedScenario}
              </span>
            </div>
          )}
        </div>

        {/* Jugend forscht Hinweis-Box mit WICHTIG */}
        <div className="mb-5 p-4 rounded-2xl bg-amber-50/70 border border-amber-200/90 text-xs sm:text-sm text-amber-950 flex items-start gap-3">
          <div className="p-2 rounded-xl bg-amber-100 text-amber-800 shrink-0">
            <Award className="w-4 h-4" />
          </div>
          <div className="leading-relaxed">
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-600 text-white text-[10px] font-black tracking-wider uppercase">
                <AlertTriangle className="w-3 h-3" />
                WICHTIG
              </span>
              <span className="font-bold text-amber-900">
                Jugend forscht Projekt-Test
              </span>
            </div>
            <p className="text-[12px] sm:text-xs text-amber-900/90">
              Wir führen diese Simulation als Test für unser <strong>Jugend forscht</strong>-Projekt durch. Bitte führe das Notrufgespräch mit <strong>Sorgfalt</strong> und achte auf präzise Angaben, damit am Ende eine fundierte <strong>Zusammenfassung</strong> erstellt werden kann.
            </p>
          </div>
        </div>

        {/* Mandatory Decision BEFORE Call: Telefonieren vs Schreiben */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-xs sm:text-sm font-black text-slate-900 uppercase tracking-wider">
              1. Wie möchtest du den Notruf absetzen? <span className="text-red-600">*</span>
            </h3>
            <span className="text-[11px] font-semibold text-slate-500">
              Vor dem Anruf wählen
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Option 1: Telefonieren (Voice) */}
            <button
              id="choose-voice-mode-btn"
              type="button"
              onClick={() => setSelectedMode('voice')}
              className={`relative p-4 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col gap-2 ${
                selectedMode === 'voice'
                  ? 'border-red-600 bg-red-50/70 ring-2 ring-red-200 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-red-300 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  selectedMode === 'voice' ? 'bg-red-600 text-white' : 'bg-red-100 text-red-600'
                }`}>
                  <Mic className="w-5 h-5" />
                </div>
                {selectedMode === 'voice' && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700 bg-white px-2 py-0.5 rounded-full border border-red-200">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Gewählt
                  </span>
                )}
              </div>
              <div>
                <div className="font-extrabold text-sm text-slate-900 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-red-600" />
                  <span>Telefonieren (Sprache)</span>
                </div>
                <p className="text-[11px] text-slate-600 mt-1 leading-snug">
                  Sprich direkt ins Handy/Mikrofon – der Disponent antwortet mit echter Stimme. Der gesamte Text erscheint live zum Mitlesen.
                </p>
              </div>
            </button>

            {/* Option 2: Schreiben (Chat) */}
            <button
              id="choose-chat-mode-btn"
              type="button"
              onClick={() => setSelectedMode('chat')}
              className={`relative p-4 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col gap-2 ${
                selectedMode === 'chat'
                  ? 'border-slate-900 bg-slate-100 ring-2 ring-slate-300 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  selectedMode === 'chat' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
                }`}>
                  <MessageSquareText className="w-5 h-5" />
                </div>
                {selectedMode === 'chat' && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-900 bg-white px-2 py-0.5 rounded-full border border-slate-300">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Gewählt
                  </span>
                )}
              </div>
              <div>
                <div className="font-extrabold text-sm text-slate-900 flex items-center gap-1.5">
                  <MessageSquareText className="w-3.5 h-3.5 text-slate-700" />
                  <span>Schreiben (Text-Chat)</span>
                </div>
                <p className="text-[11px] text-slate-600 mt-1 leading-snug">
                  Tippe deine Notruf-Meldungen über die Tastatur und lies die Antworten direkt im Einsatz-Chat mit.
                </p>
              </div>
            </button>
          </div>
        </div>

        {/* Call Controls Button Bar with Lock Counter & Mode Verification */}
        <div className="pt-3 flex flex-col-reverse sm:flex-row items-center justify-between gap-3 border-t border-slate-100">
          <button
            onClick={onCancel}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-semibold transition-colors cursor-pointer"
          >
            Abbrechen
          </button>

          <button
            id="confirm-start-call-btn"
            onClick={() => {
              if (!isButtonDisabled && selectedMode) {
                onConfirmCall(selectedMode);
              }
            }}
            disabled={isButtonDisabled}
            className={`w-full sm:w-auto px-6 py-3 rounded-xl font-bold text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 ${
              isButtonDisabled
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed border border-slate-300 shadow-none'
                : 'bg-linear-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white cursor-pointer hover:shadow-lg'
            }`}
          >
            {isTimerLocked ? (
              <>
                <Clock className="w-4 h-4 text-amber-600 animate-spin" />
                <span>
                  {!selectedMode
                    ? `Bitte Modus wählen (${secondsRemaining}s)`
                    : `Bitte lesen (Weiter in ${secondsRemaining}s)`}
                </span>
              </>
            ) : !selectedMode ? (
              <>
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>Bitte oben Telefonieren oder Schreiben wählen</span>
              </>
            ) : selectedMode === 'voice' ? (
              <>
                <Phone className="w-4 h-4 fill-white" />
                <span>Jetzt Notruf anrufen (112)</span>
                <ArrowRight className="w-4 h-4" />
              </>
            ) : (
              <>
                <MessageSquareText className="w-4 h-4" />
                <span>Jetzt Notruf-Chat starten (112)</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </motion.div>

      {/* Versionsanzeige unten in der Mitte */}
      <div className="mt-4 flex items-center justify-center">
        <span className="px-3 py-1 rounded-full bg-white/80 border border-slate-200 text-slate-500 font-mono text-[11px] font-semibold shadow-2xs">
          Version <strong className="text-slate-800">0.9.50</strong>
        </span>
      </div>
    </div>
  );
};

