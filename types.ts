export type CallState = 'idle' | 'briefing' | 'dialing' | 'connected' | 'ended';
export type CommunicationMode = 'chat' | 'voice';

export interface GeoLocation {
  lat: number;
  lng: number;
  city?: string;
  address?: string;
  displayName?: string;
  country?: string;
}

export interface DispatchedVehicle {
  id: string;
  code: string;
  name: string;
  type: string;
  station: string;
  crew: string;
  status: 'ALARM' | 'AUSGERUECKT' | 'ANFAHRT' | 'EINSATZORT';
  statusText: string;
  etaMinutes: number;
  iconType: 'truck' | 'ladder' | 'tank' | 'ambulance' | 'command' | 'rescue';
  // Map positioning data
  startLat?: number;
  startLng?: number;
  currentLat?: number;
  currentLng?: number;
  targetLat?: number;
  targetLng?: number;
  routePath?: [number, number][];
}

export interface FiveWStatus {
  wo: { completed: boolean; text: string; label: string };
  was: { completed: boolean; text: string; label: string };
  wieViele: { completed: boolean; text: string; label: string };
  welcheGefahren: { completed: boolean; text: string; label: string };
  warten: { completed: boolean; text: string; label: string };
}

export interface EmergencyEvaluation {
  stichwort: string;
  alarmstufe: number;
  dringlichkeit: 'NIEDRIG' | 'MITTEL' | 'HOCH' | 'KRITISCH';
  einsatzort: string;
  stadt?: string;
  locationGeo?: GeoLocation | null;
  lagebericht: string;
  anruferHinweise: string[];
  alarmierteEinheiten: DispatchedVehicle[];
  alarmVollautomatischAusgeloest: boolean;
  naechsteFrage: string;
  dispatcherAntwort: string;
  fiveW: FiveWStatus;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'dispatcher' | 'system';
  text: string;
  timestamp: string;
  isAudioPlaying?: boolean;
}
