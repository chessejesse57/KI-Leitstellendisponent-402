import React from 'react';
import { Phone, ShieldAlert, Flame, Car, Wind, HeartPulse, Waves, MapPin, Volume2, VolumeX, Sparkles, Lock } from 'lucide-react';
import { motion } from 'motion/react';

interface HomeScreenProps {
  onStartCall: (initialScenario?: string) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  simulatedLocation: string;
  onChangeLocation: (loc: string) => void;
  onOpenAdminPortal?: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onStartCall,
  soundEnabled,
  onToggleSound,
  simulatedLocation,
  onChangeLocation,
  onOpenAdminPortal,
}) => {
  const quickScenarios = [
    {
      title: 'Wohnungsbrand 3. OG',
      desc: 'Starke Rauchentwicklung, Personen rufen am Fenster',
      icon: Flame,
      color: 'border-amber-200 hover:border-amber-400 bg-amber-50/50 text-amber-900',
      iconColor: 'text-orange-600 bg-orange-100',
      prompt: 'Hier brennt es im 3. Obergeschoss! Es kommt dichter schwarzer Rauch aus dem Fenster und oben ruft jemand um Hilfe!',
    },
    {
      title: 'Schwerer Verkehrsunfall',
      desc: '2 Pkw frontal kollidiert, Fahrer eingeklemmt',
      icon: Car,
      color: 'border-red-200 hover:border-red-400 bg-red-50/50 text-red-900',
      iconColor: 'text-red-600 bg-red-100',
      prompt: 'Schwerer Unfall! Zwei Autos sind frontal zusammengestoßen, eine Person ist im Fahrzeug eingeklemmt und nicht ansprechbar!',
    },
    {
      title: 'Gasgeruch im Gebäude',
      desc: 'Stechender Geruch im Treppenhaus',
      icon: Wind,
      color: 'border-yellow-200 hover:border-yellow-400 bg-yellow-50/50 text-yellow-900',
      iconColor: 'text-yellow-600 bg-yellow-100',
      prompt: 'Im Mehrfamilienhaus riecht es im Treppenhaus extrem stark nach Gas und faulen Eiern! Es wohnen 8 Parteien im Haus.',
    },
    {
      title: 'Reanimation / Herz-Kreislauf',
      desc: 'Person bewusstlos, keine normale Atmung',
      icon: HeartPulse,
      color: 'border-rose-200 hover:border-rose-400 bg-rose-50/50 text-rose-900',
      iconColor: 'text-rose-600 bg-rose-100',
      prompt: 'Mein Nachbar ist plötzlich zusammengebrochen, reagiert nicht mehr und atmet nicht mehr normal! Wir brauchen sofort einen Notarzt!',
    },
    {
      title: 'Kellerüberflutung / Unwetter',
      desc: 'Wasser drückt in Keller, Stromkasten gefährdet',
      icon: Waves,
      color: 'border-blue-200 hover:border-blue-400 bg-blue-50/50 text-blue-900',
      iconColor: 'text-blue-600 bg-blue-100',
      prompt: 'Nach dem Starkregen steht das Wasser im Keller bereits 40 Zentimeter hoch und steigt weiter in Richtung Sicherungskasten!',
    },
  ];

  return (
    <div id="home-screen-root" className="min-h-screen bg-slate-50 text-slate-800 flex flex-col justify-between selection:bg-red-100">
      {/* Top controls bar with sound toggle and discreet admin lock */}
      <div className="w-full max-w-4xl mx-auto flex items-center justify-between px-4 pt-4">
        {/* Discreet & Small Admin Portal Access Button */}
        {onOpenAdminPortal ? (
          <button
            id="admin-access-btn"
            type="button"
            onClick={onOpenAdminPortal}
            className="text-[11px] text-slate-400 hover:text-slate-600 px-2 py-1 rounded-md hover:bg-slate-200/50 transition-colors flex items-center gap-1 cursor-pointer opacity-70 hover:opacity-100"
            title="JF-Auswertungen (Passwortgeschützt)"
          >
            <Lock className="w-3 h-3 text-slate-400" />
            <span className="hidden sm:inline">JF-Portal</span>
          </button>
        ) : (
          <div></div>
        )}

        <button
          id="sound-toggle-btn"
          onClick={onToggleSound}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors border shadow-2xs ${
            soundEnabled
              ? 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
              : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-100'
          }`}
          title={soundEnabled ? 'Sprachausgabe & Töne aktiv' : 'Ton stummgeschaltet'}
        >
          {soundEnabled ? <Volume2 className="w-4 h-4 text-slate-700" /> : <VolumeX className="w-4 h-4 text-slate-400" />}
          <span className="hidden sm:inline">{soundEnabled ? 'Audio Ein' : 'Audio Aus'}</span>
        </button>
      </div>

      {/* Main Content Body */}
      <main id="home-main" className="flex-1 flex flex-col items-center justify-center px-4 py-8 max-w-4xl mx-auto w-full">
        {/* Central White Card with Prominent Red Emergency Call Button */}
        <div id="call-hero-card" className="w-full bg-white rounded-3xl p-6 sm:p-10 shadow-lg border border-slate-200/80 flex flex-col items-center text-center relative overflow-hidden">
          <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full bg-red-50/60 pointer-events-none blur-2xl"></div>
          <div className="absolute -left-16 -bottom-16 w-56 h-56 rounded-full bg-amber-50/60 pointer-events-none blur-2xl"></div>

          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-2 tracking-tight">
            Notruf 112 absetzen
          </h2>
          <p className="text-sm text-slate-600 max-w-md mb-8 leading-relaxed">
            Drücke den roten Notruf-Button. Du wirst in wenigen Sekunden direkt mit dem Leitstellendisponenten der Feuerwehr verbunden.
          </p>

          {/* THE PROMINENT RED EMERGENCY CALL BUTTON */}
          <div className="relative my-2 flex items-center justify-center">
            <span className="absolute w-40 h-40 sm:w-48 sm:h-48 rounded-full bg-red-100"></span>

            <motion.button
              id="emergency-call-button"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.94 }}
              onClick={() => onStartCall()}
              className="relative z-10 w-36 h-36 sm:w-44 sm:h-44 rounded-full bg-linear-to-br from-red-500 via-red-600 to-red-700 text-white font-black shadow-2xl hover:shadow-red-500/50 flex flex-col items-center justify-center gap-1.5 border-4 border-white transition-all cursor-pointer group active:from-red-600 active:to-red-800"
            >
              <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Phone className="w-7 h-7 text-white fill-white" />
              </div>
              <span className="text-2xl sm:text-3xl font-black tracking-wider drop-shadow-xs">112</span>
              <span className="text-[11px] sm:text-xs font-semibold uppercase tracking-widest text-red-100">
                NOTRUF
              </span>
            </motion.button>
          </div>

          {/* Location & GPS Info */}
          <div className="mt-8 flex items-center justify-center gap-2.5 text-xs text-slate-600 bg-slate-50 px-4 py-2.5 rounded-xl border border-slate-200/80 max-w-md w-full">
            <MapPin className="w-4 h-4 text-red-600 shrink-0" />
            <span className="text-[11px] leading-relaxed text-slate-600">
              <strong>Einsatzgebiet Kiel:</strong> Leitstelle Feuerwehr & Rettungsdienst Kiel. Der Disponent erfasst deine Straße/Adresse in Kiel.
            </span>
          </div>
        </div>

        {/* Quick Simulation Scenarios Section */}
        <div id="scenarios-section" className="w-full mt-8">
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Schnellstart-Szenarien (Sofortige Situationstestung)</span>
            </div>
            <span className="text-[11px] text-slate-600">Direkt mit Meldung starten</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {quickScenarios.map((scen, idx) => {
              const IconComponent = scen.icon;
              return (
                <motion.button
                  key={idx}
                  id={`scenario-card-${idx}`}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onStartCall(scen.prompt)}
                  className={`p-3.5 rounded-2xl border text-left flex items-start gap-3 transition-all cursor-pointer shadow-2xs ${scen.color}`}
                >
                  <div className={`p-2 rounded-xl shrink-0 ${scen.iconColor}`}>
                    <IconComponent className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-xs sm:text-sm text-slate-900 flex items-center gap-1">
                      {scen.title}
                    </div>
                    <p className="text-[11px] text-slate-600 mt-0.5 line-clamp-2 leading-snug">
                      {scen.desc}
                    </p>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>
      </main>

      {/* Footer Info with centered version badge and discreet lock indicator */}
      <footer id="home-footer" className="w-full bg-white border-t border-slate-200 py-3 px-4 text-xs text-slate-600">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
            <span>Feuerwehr-Leitstellen-Simulator mit automatischer Alarmierungslogik</span>
          </div>

          {/* Versionsanzeige unten in der Mitte */}
          <div id="version-badge" className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200/90 text-slate-600 font-mono text-[11px] font-semibold shadow-2xs">
            <span className="text-slate-400">Version</span>
            <span className="text-slate-900 font-bold">0.9.50</span>
          </div>

          <div className="flex items-center gap-3 mt-1 sm:mt-0">
            <span className="text-[11px] text-slate-500">
              5-W-Schema • AAO • Jugend forscht
            </span>
            {onOpenAdminPortal && (
              <button
                type="button"
                onClick={onOpenAdminPortal}
                className="text-slate-300 hover:text-slate-600 transition-colors p-1"
                title="JF-Ergebnisse anzeigen (Passwort)"
              >
                <Lock className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
};
