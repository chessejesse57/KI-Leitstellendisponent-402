import React, { useState, useEffect } from 'react';
import {
  Lock,
  Unlock,
  ShieldCheck,
  RotateCcw,
  CheckCircle2,
  ThumbsUp,
  ThumbsDown,
  Clock,
  MapPin,
  RefreshCw,
  X,
  FileSpreadsheet,
  Sliders,
  Timer,
  MessageSquareOff,
  Cloud,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

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

interface AdminDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  briefingTimerEnabled: boolean;
  onToggleBriefingTimer: (enabled: boolean) => void;
  evaluationModalEnabled: boolean;
  onToggleEvaluationModal: (enabled: boolean) => void;
}

export const AdminDashboardModal: React.FC<AdminDashboardModalProps> = ({
  isOpen,
  onClose,
  briefingTimerEnabled,
  onToggleBriefingTimer,
  evaluationModalEnabled,
  onToggleEvaluationModal,
}) => {
  const [passwordInput, setPasswordInput] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [feedbacks, setFeedbacks] = useState<FeedbackEntry[]>([]);
  const [cloudSynced, setCloudSynced] = useState(true);

  // Jedes Mal, wenn das Modal geschlossen oder neu geöffnet wird, sperrt es sich sofort wieder!
  useEffect(() => {
    if (!isOpen) {
      setIsAuthenticated(false);
      setPasswordInput('');
      setErrorNotice(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    // Sofort sperren beim Verlassen
    setIsAuthenticated(false);
    setPasswordInput('');
    setErrorNotice(null);
    onClose();
  };

  const loadAllFeedbacks = async (): Promise<FeedbackEntry[]> => {
    const map = new Map<string, FeedbackEntry>();

    // 1. Zuerst aus Firebase Firestore Cloud laden (für geräteübergreifenden Zugriff)
    try {
      const snap = await getDocs(collection(db, 'feedbacks'));
      snap.forEach((docSnap) => {
        const data = docSnap.data() as FeedbackEntry;
        if (data && data.id) {
          map.set(data.id, data);
        }
      });
      setCloudSynced(true);
    } catch (firebaseErr) {
      handleFirestoreError(firebaseErr, OperationType.GET, 'feedbacks');
      setCloudSynced(false);
    }

    // 2. Zusätzlich von der lokalen Server-API laden (für nahtlose Synchronisation)
    try {
      const res = await fetch('/api/feedback/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.feedbacks && Array.isArray(data.feedbacks)) {
          data.feedbacks.forEach((fb: FeedbackEntry) => {
            if (!map.has(fb.id)) {
              map.set(fb.id, fb);
            }
          });
        }
      }
    } catch (e) {
      console.warn('Server fallback fetch failed', e);
    }

    const merged = Array.from(map.values());
    merged.sort((a, b) => {
      const timeA = new Date(a.timestamp || (a as any).createdAt || 0).getTime();
      const timeB = new Date(b.timestamp || (b as any).createdAt || 0).getTime();
      return timeB - timeA;
    });

    return merged;
  };

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!passwordInput.trim()) return;

    setIsLoading(true);
    setErrorNotice(null);

    // Passwortprüfung (autorisiertes JF-Team: jfprofis)
    if (passwordInput.trim() !== 'jfprofis') {
      setErrorNotice('Falsches Passwort!');
      setIsLoading(false);
      return;
    }

    try {
      const list = await loadAllFeedbacks();
      setIsAuthenticated(true);
      setFeedbacks(list);
    } catch (err: any) {
      setErrorNotice('Fehler beim Laden der Auswertungen');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      const list = await loadAllFeedbacks();
      setFeedbacks(list);
    } catch (_) {}
    setIsLoading(false);
  };

  const formatSecs = (secs?: number) => {
    if (!secs) return '0:00';
    const m = Math.floor(secs / 60);
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  // Live-Berechnungen für die Jugend-forscht-Statistik
  const totalCount = feedbacks.length;
  const gutCount = feedbacks.filter((f) => f.overallRating === 'gut').length;
  const verbesserungCount = feedbacks.filter((f) => f.overallRating === 'verbesserung').length;
  const gutPercent = totalCount > 0 ? Math.round((gutCount / totalCount) * 100) : 0;

  const criteriaCounts = {
    verstaendlichkeit: feedbacks.filter((f) => f.criteria?.verstaendlichkeit).length,
    schnelligkeit: feedbacks.filter((f) => f.criteria?.schnelligkeit).length,
    korrekteKraefte: feedbacks.filter((f) => f.criteria?.korrekteKraefte).length,
    realistisch: feedbacks.filter((f) => f.criteria?.realistisch).length,
    einsatzstichwortTreffend: feedbacks.filter((f) => f.criteria?.einsatzstichwortTreffend).length,
    fuenfWReihenfolge: feedbacks.filter((f) => f.criteria?.fuenfWReihenfolge).length,
    nachalarmierungFunktioniert: feedbacks.filter((f) => f.criteria?.nachalarmierungFunktioniert).length,
    anweisungenVerstaendlich: feedbacks.filter((f) => f.criteria?.anweisungenVerstaendlich).length,
  };

  return (
    <div id="admin-dashboard-overlay" className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-3xl max-w-4xl w-full p-5 sm:p-7 shadow-2xl border border-slate-200 overflow-hidden relative max-h-[92vh] flex flex-col"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3.5 mb-3 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-xs">
              {isAuthenticated ? <Unlock className="w-5 h-5 text-emerald-400" /> : <Lock className="w-5 h-5 text-amber-400" />}
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-slate-900 leading-tight">
                Auswertungs-Portal • Jugend forscht
              </h3>
              <p className="text-[11px] text-slate-500">
                Geschützter Bereich (sperrt sich nach jedem Schließen automatisch wieder)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer transition-colors"
            title="Schließen & Sperren"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Section: Password Gate or Dashboard Results */}
        {!isAuthenticated ? (
          <div className="my-auto py-8 max-w-md mx-auto w-full text-center">
            <div className="w-16 h-16 rounded-2xl bg-amber-100 border border-amber-200 text-amber-700 mx-auto flex items-center justify-center mb-4 shadow-sm">
              <Lock className="w-8 h-8" />
            </div>

            <h4 className="text-lg font-black text-slate-900 mb-1">
              Passwortgeschützter Zugang
            </h4>
            <p className="text-xs text-slate-600 mb-5">
              Bitte gib das Passwort ein, um die Feedback-Ergebnisse und die Live-Statistik einzusehen:
            </p>

            <form onSubmit={handleLogin} className="space-y-3">
              <div className="relative">
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Passwort eingeben..."
                  autoFocus
                  className="w-full py-3 px-4 rounded-xl border border-slate-300 focus:border-red-600 focus:outline-hidden text-sm font-mono text-center tracking-wider text-slate-900 bg-slate-50 focus:bg-white transition-all shadow-inner"
                />
              </div>

              {errorNotice && (
                <p className="text-xs font-bold text-red-600 animate-shake">
                  {errorNotice}
                </p>
              )}

              <button
                type="submit"
                disabled={isLoading || !passwordInput}
                className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold text-xs sm:text-sm shadow-md cursor-pointer transition-all flex items-center justify-center gap-2"
              >
                {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
                <span>Ergebnisse freischalten</span>
              </button>
            </form>
          </div>
        ) : (
          /* AUTHENTICATED: Display Live Results and Analysis */
          <div className="overflow-y-auto pr-1 space-y-4 flex-1">
            {/* Administrator Schieberegler / Ablauf-Steuerung */}
            <div className="p-4 rounded-2xl bg-linear-to-br from-slate-900 to-slate-800 text-white shadow-md border border-slate-700">
              <div className="flex items-center justify-between mb-3 border-b border-slate-700/80 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-red-600/30 text-red-400 border border-red-500/30">
                    <Sliders className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs sm:text-sm font-black tracking-tight text-white">
                      Simulator-Steuerung (Admin-Schieberegler)
                    </h4>
                    <p className="text-[10px] text-slate-400">
                      Abläufe für Testläufe & Notruf-Präsentationen live anpassen
                    </p>
                  </div>
                </div>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
                  Admin Modus
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* 1. Schieberegler: 15-Sekunden-Wartezeit */}
                <div className="p-3 rounded-xl bg-slate-800/90 border border-slate-700 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                        <Timer className="w-3.5 h-3.5 text-amber-400" />
                        15-Sekunden-Wartezeit vor Notruf
                      </span>
                      <span className={`text-[10px] font-black uppercase font-mono px-2 py-0.5 rounded-md ${
                        briefingTimerEnabled ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-slate-700 text-slate-400'
                      }`}>
                        {briefingTimerEnabled ? '15s Aktiv' : 'Aus (0s)'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                      Verpflichtende Lesepause auf dem Einführungs-Fenster vor dem Notruf.
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-700/60">
                    <span className="text-[11px] font-medium text-slate-300">
                      Status: {briefingTimerEnabled ? 'Wartezeit an' : 'Sofort weiter (Aus)'}
                    </span>
                    {/* Schieberegler Switch */}
                    <button
                      type="button"
                      onClick={() => onToggleBriefingTimer(!briefingTimerEnabled)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                        briefingTimerEnabled ? 'bg-emerald-500' : 'bg-slate-600'
                      }`}
                      role="switch"
                      aria-checked={briefingTimerEnabled}
                      title={briefingTimerEnabled ? 'Klicken zum Deaktivieren (0s Wartezeit)' : 'Klicken zum Aktivieren (15s Wartezeit)'}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                          briefingTimerEnabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* 2. Schieberegler: Bewertungs-Fenster am Einsatzende */}
                <div className="p-3 rounded-xl bg-slate-800/90 border border-slate-700 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                        <MessageSquareOff className="w-3.5 h-3.5 text-blue-400" />
                        Bewertungs-Fenster am Einsatzende
                      </span>
                      <span className={`text-[10px] font-black uppercase font-mono px-2 py-0.5 rounded-md ${
                        evaluationModalEnabled ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-red-500/20 text-red-300 border border-red-500/30'
                      }`}>
                        {evaluationModalEnabled ? 'Aktiv (An)' : 'Deaktiviert (Aus)'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                      Wenn dieser Schieberegler auf <strong>AUS</strong> steht, ist das Bewertungs-Fenster am Ende komplett weg und man landet direkt auf der Startseite.
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-700/60">
                    <span className="text-[11px] font-medium text-slate-300">
                      Status: {evaluationModalEnabled ? 'Fenster aktiv' : 'Fenster weg (Aus)'}
                    </span>
                    {/* Schieberegler Switch */}
                    <button
                      type="button"
                      onClick={() => onToggleEvaluationModal(!evaluationModalEnabled)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                        evaluationModalEnabled ? 'bg-emerald-500' : 'bg-slate-600'
                      }`}
                      role="switch"
                      aria-checked={evaluationModalEnabled}
                      title={evaluationModalEnabled ? 'Klicken zum Deaktivieren (Bewertung überspringen)' : 'Klicken zum Aktivieren (Bewertungs-Fenster anzeigen)'}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                          evaluationModalEnabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Stat Cards Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] font-bold text-slate-500 uppercase block">Gesamt Feedback</span>
                <span className="text-2xl font-black text-slate-900">{totalCount}</span>
                <span className="text-[10px] text-slate-500 block mt-0.5">abgeschlossene Notrufe</span>
              </div>

              <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200">
                <span className="text-[11px] font-bold text-emerald-800 uppercase block">Zufriedenheit</span>
                <span className="text-2xl font-black text-emerald-700">{gutPercent}%</span>
                <span className="text-[10px] text-emerald-600 block mt-0.5">{gutCount} von {totalCount} positiv</span>
              </div>

              <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200">
                <span className="text-[11px] font-bold text-amber-800 uppercase block">Verbesserung</span>
                <span className="text-2xl font-black text-amber-700">{verbesserungCount}</span>
                <span className="text-[10px] text-amber-600 block mt-0.5">Anmerkungen/Kritik</span>
              </div>

              <div className="p-3.5 rounded-2xl bg-blue-50 border border-blue-200 flex flex-col justify-between">
                <span className="text-[11px] font-bold text-blue-800 uppercase block">Cloud Speicher</span>
                <div className="flex items-center gap-1.5 text-xs font-bold text-blue-700">
                  <Cloud className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="truncate">Firestore Cloud</span>
                </div>
                <button
                  type="button"
                  onClick={handleRefresh}
                  className="text-[10px] text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 cursor-pointer mt-1"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>Jetzt abgleichen</span>
                </button>
              </div>
            </div>

            {/* Criteria Percentages Breakdown */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 mb-3 flex items-center justify-between">
                <span>Auswertung nach Test-Kriterien (Zustimmungsrate)</span>
                <span className="text-[11px] font-normal text-slate-500">{totalCount} Datensätze</span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {[
                  { label: 'Disponent ruhig & verständlich', count: criteriaCounts.verstaendlichkeit },
                  { label: 'Zügige Notrufaufnahme & Alarmierung', count: criteriaCounts.schnelligkeit },
                  { label: 'Passende Einsatzkräfte entsandt', count: criteriaCounts.korrekteKraefte },
                  { label: 'Realistische Simulation', count: criteriaCounts.realistisch },
                  { label: 'Einsatzstichwort & Alarmstufe treffend', count: criteriaCounts.einsatzstichwortTreffend },
                  { label: '5-W-Schema logisch & fehlerfrei', count: criteriaCounts.fuenfWReihenfolge },
                  { label: 'Nachalarmierung funktionierte wie gewünscht', count: criteriaCounts.nachalarmierungFunktioniert },
                  { label: 'Anweisungen an den Anrufer klar', count: criteriaCounts.anweisungenVerstaendlich },
                ].map((crit, idx) => {
                  const pct = totalCount > 0 ? Math.round((crit.count / totalCount) * 100) : 0;
                  return (
                    <div key={idx} className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-2xs">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[11px] font-bold text-slate-800 truncate pr-2">{crit.label}</span>
                        <span className="font-mono text-[11px] font-black text-slate-900">{crit.count}/{totalCount} ({pct}%)</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* List of individual submissions */}
            <div className="space-y-2">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 px-1">
                Eingegangene Einzelfeedbacks ({feedbacks.length})
              </h4>

              {feedbacks.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  Noch keine Feedback-Einträge vorhanden. Nach Beendigung eines Notrufs fließen die Bewertungen hier direkt ein.
                </div>
              ) : (
                feedbacks.map((fb) => (
                  <div
                    key={fb.id}
                    className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-2xs flex flex-col gap-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {fb.overallRating === 'gut' ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                            <ThumbsUp className="w-3 h-3" />
                            <span>Alles super</span>
                          </span>
                        ) : fb.overallRating === 'verbesserung' ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1">
                            <ThumbsDown className="w-3 h-3" />
                            <span>Verbesserungsbedarf</span>
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700">
                            Keine Gesamtnote
                          </span>
                        )}

                        <span className="font-bold text-xs text-slate-900">{fb.stichwort || 'Feuerwehreinsatz'}</span>
                      </div>

                      <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                        <Clock className="w-3 h-3" />
                        <span>Dauer: {formatSecs(fb.durationSeconds)}</span>
                        <span>•</span>
                        <span>{formatDate(fb.timestamp)}</span>
                      </div>
                    </div>

                    {/* Criteria badges */}
                    <div className="flex flex-wrap gap-1.5 text-[10px]">
                      {fb.criteria?.verstaendlichkeit && (
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                          ✓ Verständlich
                        </span>
                      )}
                      {fb.criteria?.schnelligkeit && (
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                          ✓ Zügig alarmiert
                        </span>
                      )}
                      {fb.criteria?.korrekteKraefte && (
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                          ✓ Passende Kräfte
                        </span>
                      )}
                      {fb.criteria?.realistisch && (
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                          ✓ Realistisch
                        </span>
                      )}
                      {fb.criteria?.einsatzstichwortTreffend && (
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                          ✓ Treffendes Stichwort
                        </span>
                      )}
                      {fb.criteria?.fuenfWReihenfolge && (
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                          ✓ Logisches 5-W Schema
                        </span>
                      )}
                      {fb.criteria?.nachalarmierungFunktioniert && (
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                          ✓ Nachalarmierung
                        </span>
                      )}
                      {fb.criteria?.anweisungenVerstaendlich && (
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                          ✓ Klare Anweisungen
                        </span>
                      )}
                    </div>

                    {/* User feedback text comment */}
                    {fb.comment && (
                      <div className="mt-1 p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-800 italic whitespace-pre-wrap max-h-32 overflow-y-auto">
                        „{fb.comment}“
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Modal Footer */}
        <div className="pt-3.5 mt-3 border-t border-slate-100 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-slate-500 font-mono">
            {isAuthenticated ? 'Status: Authentifiziert als Projektteam (jfprofis)' : 'Passwortgeschützt (jfprofis)'}
          </span>
          <span className="text-[11px] text-slate-400 font-mono font-medium">
            Version 0.9.50
          </span>
          <button
            type="button"
            onClick={handleClose}
            className="py-2 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold cursor-pointer transition-colors"
          >
            Schließen & Sperren
          </button>
        </div>
      </motion.div>
    </div>
  );
};
