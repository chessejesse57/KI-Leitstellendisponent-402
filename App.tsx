import React, { useState } from 'react';
import { CallState, CommunicationMode, EmergencyEvaluation, ChatMessage } from './types';
import { HomeScreen } from './components/HomeScreen';
import { BriefingScreen } from './components/BriefingScreen';
import { CallingScreen } from './components/CallingScreen';
import { ActiveCallScreen } from './components/ActiveCallScreen';
import { CallEndedModal } from './components/CallEndedModal';
import { AdminDashboardModal } from './components/AdminDashboardModal';
import { audioManager } from './utils/audio';

export default function App() {
  const [callState, setCallState] = useState<CallState>('idle');
  const [communicationMode, setCommunicationMode] = useState<CommunicationMode>('chat');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [simulatedLocation, setSimulatedLocation] = useState<string>('');
  const [selectedScenario, setSelectedScenario] = useState<string | undefined>(undefined);

  // Completed call summary data
  const [lastEvaluation, setLastEvaluation] = useState<EmergencyEvaluation | null>(null);
  const [lastMessages, setLastMessages] = useState<ChatMessage[]>([]);
  const [lastDuration, setLastDuration] = useState<number>(0);
  const [showSummaryModal, setShowSummaryModal] = useState<boolean>(false);

  // Password-protected Admin / JF Results Modal
  const [showAdminPortal, setShowAdminPortal] = useState<boolean>(false);

  // Administrator Schieberegler-Einstellungen (gespeichert in localStorage, Standard: true)
  const [briefingTimerEnabled, setBriefingTimerEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('jf_briefing_timer_enabled');
    return saved !== null ? saved === 'true' : true;
  });

  const [evaluationModalEnabled, setEvaluationModalEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('jf_evaluation_modal_enabled');
    return saved !== null ? saved === 'true' : true;
  });

  const handleToggleBriefingTimer = (enabled: boolean) => {
    setBriefingTimerEnabled(enabled);
    localStorage.setItem('jf_briefing_timer_enabled', String(enabled));
  };

  const handleToggleEvaluationModal = (enabled: boolean) => {
    setEvaluationModalEnabled(enabled);
    localStorage.setItem('jf_evaluation_modal_enabled', String(enabled));
  };

  // When clicking on emergency call button or a scenario -> show briefing introduction screen
  const handleStartCall = (initialScenario?: string) => {
    setSelectedScenario(initialScenario);
    setShowSummaryModal(false);
    setCallState('briefing');
  };

  // Confirming from briefing screen with selected mode (voice vs chat)
  const handleConfirmCallFromBriefing = (mode: CommunicationMode) => {
    setCommunicationMode(mode);
    setCallState('dialing');
  };

  // Cancelling from briefing screen returns to home
  const handleCancelBriefing = () => {
    setCallState('idle');
    setSelectedScenario(undefined);
  };

  // Connected to AI Dispatcher after countdown/ringing
  const handleConnected = () => {
    setCallState('connected');
  };

  // Cancel dialing
  const handleCancelDialing = () => {
    if (soundEnabled) {
      audioManager.playHangupTone();
    }
    setCallState('idle');
    setSelectedScenario(undefined);
  };

  // Hang Up from active call
  const handleHangUp = (
    evaluation: EmergencyEvaluation | null,
    messages: ChatMessage[],
    durationSeconds: number
  ) => {
    if (soundEnabled) {
      audioManager.playHangupTone();
    }
    setLastEvaluation(evaluation);
    setLastMessages(messages);
    setLastDuration(durationSeconds);

    // Wenn der Schieberegler im Admin-Portal auf AUS steht, Bewertungs-Fenster überspringen!
    if (evaluationModalEnabled) {
      setShowSummaryModal(true);
    } else {
      setShowSummaryModal(false);
    }

    setCallState('idle');
    setSelectedScenario(undefined);
  };

  // Close summary modal and stay on clean white home screen
  const handleCloseModalToHome = () => {
    setShowSummaryModal(false);
    setCallState('idle');
  };

  const handleToggleSound = () => {
    setSoundEnabled((prev) => !prev);
  };

  return (
    <div id="app-root" className="min-h-screen bg-slate-50 font-sans antialiased text-slate-900">
      {/* 1. White Home Screen with prominent red call button & subtle hidden admin portal button */}
      {callState === 'idle' && (
        <HomeScreen
          onStartCall={handleStartCall}
          soundEnabled={soundEnabled}
          onToggleSound={handleToggleSound}
          simulatedLocation={simulatedLocation}
          onChangeLocation={setSimulatedLocation}
          onOpenAdminPortal={() => setShowAdminPortal(true)}
        />
      )}

      {/* 1b. Briefing introduction screen with mandatory Telefonieren vs Schreiben selection */}
      {callState === 'briefing' && (
        <BriefingScreen
          onConfirmCall={handleConfirmCallFromBriefing}
          onCancel={handleCancelBriefing}
          selectedScenario={selectedScenario}
          waitTimerEnabled={briefingTimerEnabled}
        />
      )}

      {/* 2. Dialing / Ringing connecting screen */}
      {callState === 'dialing' && (
        <CallingScreen
          onConnected={handleConnected}
          onCancel={handleCancelDialing}
          soundEnabled={soundEnabled}
          communicationMode={communicationMode}
        />
      )}

      {/* 3. Connected AI Fire Dispatcher Screen */}
      {callState === 'connected' && (
        <ActiveCallScreen
          initialScenario={selectedScenario}
          simulatedLocation={simulatedLocation}
          soundEnabled={soundEnabled}
          communicationMode={communicationMode}
          onToggleSound={handleToggleSound}
          onHangUp={handleHangUp}
        />
      )}

      {/* 4. Post-call mission dispatch receipt modal with feedback survey */}
      {showSummaryModal && (
        <CallEndedModal
          evaluation={lastEvaluation}
          messages={lastMessages}
          durationSeconds={lastDuration}
          onCloseToHome={handleCloseModalToHome}
        />
      )}

      {/* 5. Password-protected JF Results Portal (Passwort: jfprofis) */}
      <AdminDashboardModal
        isOpen={showAdminPortal}
        onClose={() => setShowAdminPortal(false)}
        briefingTimerEnabled={briefingTimerEnabled}
        onToggleBriefingTimer={handleToggleBriefingTimer}
        evaluationModalEnabled={evaluationModalEnabled}
        onToggleEvaluationModal={handleToggleEvaluationModal}
      />
    </div>
  );
}
