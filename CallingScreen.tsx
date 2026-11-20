import React, { useEffect, useState } from 'react';
import { Phone, PhoneOff, ShieldAlert, Wifi, MessageSquareText } from 'lucide-react';
import { motion } from 'motion/react';
import { audioManager } from '../utils/audio';
import { CommunicationMode } from '../types';

interface CallingScreenProps {
  onConnected: () => void;
  onCancel: () => void;
  soundEnabled: boolean;
  communicationMode?: CommunicationMode;
}

export const CallingScreen: React.FC<CallingScreenProps> = ({
  onConnected,
  onCancel,
  soundEnabled,
  communicationMode = 'voice',
}) => {
  const [seconds, setSeconds] = useState(0);
  const [statusText, setStatusText] = useState(
    communicationMode === 'chat' ? 'Verbinde Notruf-Chat 112...' : 'Wähle Notruf 112...'
  );

  useEffect(() => {
    if (communicationMode === 'chat') {
      if (soundEnabled) {
        audioManager.playRadioBeep();
      }
      return;
    }

    // Start audio ringing in voice phone mode if enabled
    let stopRinging: (() => void) | null = null;
    if (soundEnabled) {
      audioManager.playDialTone(1200);
      const ringTimeout = setTimeout(() => {
        stopRinging = audioManager.startRinging();
      }, 1000);
      return () => {
        clearTimeout(ringTimeout);
        if (stopRinging) stopRinging();
      };
    }
  }, [soundEnabled, communicationMode]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);

    if (communicationMode === 'chat') {
      const quickConnect = setTimeout(() => {
        onConnected();
      }, 1200);
      return () => {
        clearInterval(timer);
        clearTimeout(quickConnect);
      };
    }

    const step1 = setTimeout(() => {
      setStatusText('Leitstelle 112 kontaktiert – Freizeichen...');
    }, 1200);

    const step2 = setTimeout(() => {
      setStatusText('KI-Disponent nimmt Anruf entgegen...');
    }, 3000);

    const step3 = setTimeout(() => {
      if (soundEnabled) {
        audioManager.playRadioBeep();
      }
      onConnected();
    }, 4000);

    return () => {
      clearInterval(timer);
      clearTimeout(step1);
      clearTimeout(step2);
      clearTimeout(step3);
    };
  }, [onConnected, soundEnabled, communicationMode]);

  return (
    <div id="calling-screen-root" className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-between p-6 relative overflow-hidden">
      {/* Background rings (static) */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-96 h-96 rounded-full bg-red-600/5"></div>
        <div className="w-72 h-72 rounded-full bg-red-600/10"></div>
      </div>

      {/* Top Header */}
      <div className="w-full max-w-md flex items-center justify-between z-10 pt-4">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-red-400 bg-red-950/60 px-3 py-1.5 rounded-full border border-red-800/60">
          <ShieldAlert className="w-4 h-4 text-red-500" />
          <span>PRIORITÄTSVERBINDUNG</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Wifi className="w-3.5 h-3.5 text-emerald-400" />
          <span>Direktleitung 112</span>
        </div>
      </div>

      {/* Center Phone Call Status */}
      <div className="flex flex-col items-center text-center z-10 my-auto">
        <div className="w-32 h-32 rounded-full bg-red-600/30 border-2 border-red-500 flex items-center justify-center mb-6 shadow-xl shadow-red-900/50">
          <div className="w-24 h-24 rounded-full bg-linear-to-b from-red-500 to-red-700 flex items-center justify-center shadow-lg">
            {communicationMode === 'chat' ? (
              <MessageSquareText className="w-12 h-12 text-white" />
            ) : (
              <Phone className="w-12 h-12 text-white fill-white" />
            )}
          </div>
        </div>

        <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-wider mb-2">
          112
        </h2>
        <p className="text-lg font-medium text-slate-300 mb-1">
          Feuerwehr & Rettungsdienst
        </p>
        <p className="text-sm font-semibold text-red-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500"></span>
          {statusText}
        </p>

        <p className="text-xs text-slate-500 mt-6">
          {communicationMode === 'chat'
            ? `Chat-Verbindung wird aufgebaut (${seconds}s)...`
            : `Verbindungsaufbau (${seconds}s)... Bitte bleiben Sie am Apparat.`}
        </p>
      </div>

      {/* Bottom Actions */}
      <div className="w-full max-w-xs flex flex-col items-center gap-3 z-10 pb-6">
        <motion.button
          id="cancel-call-button"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onCancel}
          className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 active:bg-red-800 text-white flex items-center justify-center shadow-lg shadow-red-900/40 border-2 border-red-400 cursor-pointer"
          title="Notruf abbrechen"
        >
          <PhoneOff className="w-7 h-7" />
        </motion.button>
        <span className="text-xs text-slate-400 font-medium">Abbrechen</span>
      </div>
    </div>
  );
};
