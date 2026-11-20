import React, { useState, useRef, useEffect } from 'react';
import {
  CheckCircle2,
  Truck,
  MapPin,
  RotateCcw,
  ThumbsUp,
  ThumbsDown,
  CheckSquare,
  AlertCircle,
  Cloud,
} from 'lucide-react';
import { motion } from 'motion/react';
import { EmergencyEvaluation, ChatMessage } from '../types';
import { doc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

interface CallEndedModalProps {
  evaluation: EmergencyEvaluation | null;
  messages: ChatMessage[];
  durationSeconds: number;
  onCloseToHome: () => void;
}

export const CallEndedModal: React.FC<CallEndedModalProps> = ({
  evaluation,
  messages,
  durationSeconds,
  onCloseToHome,
}) => {
  const [overallRating, setOverallRating] = useState<'gut' | 'verbesserung' | null>(null);

  // Default: NONE pre-checked (alles false!)
  const [feedbackOptions, setFeedbackOptions] = useState<{ [key: string]: boolean }>({
    verstaendlichkeit: false,
    schnelligkeit: false,
    korrekteKraefte: false,
    realistisch: false,
    einsatzstichwortTreffend: false,
    fuenfWReihenfolge: false,
    nachalarmierungFunktioniert: false,
    anweisungenVerstaendlich: false,
  });

  const [comment, setComment] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [savedToCloud, setSavedToCloud] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-expand textarea with text length while allowing scrolling up to max-height
  const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setComment(e.target.value);
    if (validationError && e.target.value.trim().length >= 5) {
      setValidationError(null);
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(180, Math.max(68, textareaRef.current.scrollHeight))}px`;
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(180, Math.max(68, textareaRef.current.scrollHeight))}px`;
    }
  }, [comment]);

  const toggleOption = (key: string) => {
    setFeedbackOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const units = evaluation?.alarmierteEinheiten || [];

  const handleFinish = async () => {
    // Pflichtfeld-Validierung: Nutzer MUSS eine eigene kurze Bewertung schreiben!
    if (!comment.trim() || comment.trim().length < 5) {
      setValidationError('Bitte beschreibe kurz deine eigene Bewertung (mindestens 5 Zeichen), um die Auswertung abzuschließen.');
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
      return;
    }

    if (!overallRating) {
      setValidationError('Bitte wähle oben kurz aus: „Ja, alles super gelaufen“ oder „Verbesserungsbedarf“.');
      return;
    }

    setValidationError(null);
    setIsSubmitting(true);

    const feedbackId = `fb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const payload = {
      id: feedbackId,
      createdAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      stichwort: evaluation?.stichwort || 'Feuerwehreinsatz',
      einsatzort: evaluation?.einsatzort || 'Kiel',
      durationSeconds,
      overallRating,
      criteria: feedbackOptions,
      comment: comment.trim(),
    };

    // 1. Speichern direkt in Firebase Firestore (damit es von JEDEM PC aus dauerhaft erhalten bleibt)
    try {
      await setDoc(doc(db, 'feedbacks', feedbackId), payload);
      setSavedToCloud(true);
    } catch (firebaseErr) {
      handleFirestoreError(firebaseErr, OperationType.WRITE, `feedbacks/${feedbackId}`);
    }

    // 2. Parallele Sicherung auf dem Server-Dateisystem als Fallback
    try {
      await fetch('/api/feedback/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.warn('Could not save feedback to backend server', err);
    }

    setFeedbackSubmitted(true);
    setTimeout(() => {
      onCloseToHome();
    }, 600);
  };

  return (
    <div id="call-ended-overlay" className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="bg-white rounded-3xl max-w-xl w-full p-5 sm:p-7 shadow-2xl border border-slate-200 overflow-hidden relative my-auto max-h-[92vh] flex flex-col"
      >
        {/* Top Header Badge */}
        <div className="flex items-center gap-3 mb-3 shrink-0">
          <div className="w-11 h-11 rounded-2xl bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg sm:text-xl font-black text-slate-900 leading-tight">
              Notruf beendet – Kräfte eingetroffen
            </h3>
            <p className="text-xs text-slate-500">
              Einsatzprotokoll Leitstelle 112 • Gesprächsdauer: {formatTime(durationSeconds)}
            </p>
          </div>
        </div>

        {/* Scrollable Container */}
        <div className="overflow-y-auto space-y-4 pr-1 flex-1">
          {/* Alarm Summary Box */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-extrabold uppercase tracking-wider text-red-700">
                {evaluation?.stichwort || 'Feuerwehreinsatz'}
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-800">
                Alarmstufe {evaluation?.alarmstufe || 1}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs mb-2.5">
              <div className="flex items-center gap-1.5 text-slate-700">
                <MapPin className="w-3.5 h-3.5 text-red-500 shrink-0" />
                <span className="truncate">Ort: <strong>{evaluation?.einsatzort || 'Kiel'}</strong></span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-700">
                <Truck className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span>Einheiten: <strong>{units.length} alarmiert</strong></span>
              </div>
            </div>

            {/* Units Badges (only vehicle designations like HLF 20, RTW, DLK 23/12, NEF) */}
            {units.length > 0 && (
              <div className="pt-2 border-t border-slate-200/80 flex flex-wrap gap-1.5">
                {units.map((u) => (
                  <span
                    key={u.id}
                    className="text-xs font-bold px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-slate-800 flex items-center gap-1.5 shadow-2xs"
                  >
                    <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                    {u.type || u.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Feedback & Evaluation Query */}
          <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 text-slate-800">
            <div className="flex items-center gap-2 mb-2">
              <CheckSquare className="w-4 h-4 text-amber-700 shrink-0" />
              <h4 className="text-xs sm:text-sm font-black text-slate-900">
                Einsatz-Auswertung & Jugend-forscht-Fragebogen
              </h4>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-600 mb-3">
              Bitte bewerte den Notruf. Alle Eingaben werden geräteübergreifend direkt in <strong>Firebase Firestore Cloud</strong> gespeichert und fließen live in das JF-Portal ein (dauerhaft von jedem PC abrufbar):
            </p>

            {/* Overall Rating Buttons */}
            <div className="grid grid-cols-2 gap-2.5 mb-3.5">
              <button
                type="button"
                onClick={() => {
                  setOverallRating('gut');
                  if (validationError?.includes('Gesamtnote') || validationError?.includes('oben')) {
                    setValidationError(null);
                  }
                }}
                className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all ${
                  overallRating === 'gut'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                <ThumbsUp className="w-3.5 h-3.5" />
                <span>Ja, alles super gelaufen</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setOverallRating('verbesserung');
                  if (validationError?.includes('Gesamtnote') || validationError?.includes('oben')) {
                    setValidationError(null);
                  }
                }}
                className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all ${
                  overallRating === 'verbesserung'
                    ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                <ThumbsDown className="w-3.5 h-3.5" />
                <span>Verbesserungsbedarf</span>
              </button>
            </div>

            {/* Extended Checklist Checkboxes - NONE PRECHECKED */}
            <div className="space-y-1.5 pt-1">
              <span className="text-[11px] font-bold text-slate-700 block mb-1">
                Kriterien & Fragen (zutreffendes bitte ankreuzen):
              </span>

              {[
                { id: 'verstaendlichkeit', label: 'Disponent hat ruhig, professionell & verständlich gefragt' },
                { id: 'schnelligkeit', label: 'Einsatz wurde zügig & ohne unnötige Verzögerung aufgenommen' },
                { id: 'korrekteKraefte', label: 'Passende Einsatzkräfte wurden alarmiert (Feuerwehr / Rettungsdienst)' },
                { id: 'realistisch', label: 'Simulation fühlte sich wie ein echter 112-Notruf an' },
                { id: 'einsatzstichwortTreffend', label: 'Einsatzstichwort & Alarmstufe passten genau zur gemeldeten Lage' },
                { id: 'fuenfWReihenfolge', label: 'Das 5-W Schema (Wo, Was, Wie viele, Welche Gefahren) war logisch' },
                { id: 'nachalarmierungFunktioniert', label: 'Nachalarmierung weiterer Fahrzeuge hat wunschgemäß geklappt' },
                { id: 'anweisungenVerstaendlich', label: 'Anweisungen & Rückfragen des Disponenten waren eindeutig' },
              ].map((item) => (
                <label
                  key={item.id}
                  className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-amber-100/60 cursor-pointer text-xs text-slate-800 transition-colors select-none"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(feedbackOptions[item.id])}
                    onChange={() => toggleOption(item.id)}
                    className="w-4 h-4 rounded text-red-600 focus:ring-red-500 border-slate-300 cursor-pointer"
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>

            {/* Comment Section: Pflichtfeld - Nutzer MUSS eigene Bewertung beschreiben */}
            <div className="mt-3.5 pt-2.5 border-t border-amber-200/80">
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="feedback-comment-input" className="block text-[11px] font-bold text-slate-900">
                  Deine eigene Bewertung <span className="text-red-600 font-extrabold">*Pflichtfeld</span>:
                </label>
                <span className="text-[10px] text-slate-500">
                  {comment.trim().length} Zeichen
                </span>
              </div>

              <div className="relative">
                <textarea
                  id="feedback-comment-input"
                  ref={textareaRef}
                  value={comment}
                  onChange={handleCommentChange}
                  rows={2}
                  placeholder="Beschreibe kurz deine eigene Erfahrung (z.B. Wie hat der Disponent reagiert? Was war gut oder was kann verbessert werden?)..."
                  style={{ minHeight: '74px', maxHeight: '180px' }}
                  className={`w-full text-xs p-3 rounded-xl bg-white border focus:outline-hidden text-slate-900 overflow-y-auto leading-relaxed transition-all shadow-inner ${
                    validationError && !comment.trim()
                      ? 'border-red-500 ring-2 ring-red-200'
                      : 'border-slate-300 focus:border-amber-500'
                  }`}
                />
              </div>

              {/* Validation Warning Notice */}
              {validationError && (
                <div className="mt-2 p-2 rounded-lg bg-red-100 border border-red-300 text-red-800 text-xs font-semibold flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{validationError}</span>
                </div>
              )}
            </div>

            {feedbackSubmitted && (
              <div className="mt-2.5 text-xs font-bold text-emerald-700 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                <span>Vielen Dank! Deine Auswertung wurde zentral gespeichert und ist ab sofort im JF-Portal sichtbar.</span>
              </div>
            )}
          </div>
        </div>

        {/* Return Button to White Home Screen */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center gap-2 shrink-0">
          <button
            id="close-to-home-btn"
            onClick={handleFinish}
            disabled={isSubmitting}
            className="w-full sm:flex-1 py-3 px-4 rounded-xl bg-red-600 hover:bg-red-700 active:bg-red-800 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-red-900/20 cursor-pointer transition-all border border-red-500"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Auswertung absenden & Zurück zur Hauptseite</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
};
