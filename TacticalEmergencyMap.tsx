import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Crosshair,
  Maximize2,
  Minimize2,
  Navigation,
  Radio,
} from 'lucide-react';
import { GeoLocation, DispatchedVehicle } from '../types';
import { getPositionAlongRoute, getStreetRoute } from '../utils/routeUtils';

// Fix standard Leaflet default icon paths in bundler environments
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Kiel Central Coordinates
const KIEL_CENTER_LAT = 54.3233;
const KIEL_CENTER_LNG = 10.1228;

interface TacticalEmergencyMapProps {
  locationGeo: GeoLocation | null;
  units: DispatchedVehicle[];
  arrivalProgressPercent: number; // 0 to 100
  isArrivalComplete: boolean;
}

export const TacticalEmergencyMap: React.FC<TacticalEmergencyMapProps> = ({
  locationGeo,
  units,
  arrivalProgressPercent,
  isArrivalComplete,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const incidentMarkerRef = useRef<L.Marker | null>(null);
  const vehicleMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const routePolylinesRef = useRef<Map<string, L.Polyline>>(new Map());
  const cachedRoutesRef = useRef<Map<string, Array<[number, number]>>>(new Map());
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  // Target coordinates in Kiel
  const targetLat = locationGeo?.lat ?? KIEL_CENTER_LAT;
  const targetLng = locationGeo?.lng ?? KIEL_CENTER_LNG;
  const hasSpecificAddress = !!locationGeo && typeof locationGeo.lat === 'number' && typeof locationGeo.lng === 'number';

  // 1. Initialize Leaflet Map centered and zoomed into Kiel (pure street map view only)
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    // Zoom 13 shows Kiel and its complete district / street layout clearly
    const initialZoom = hasSpecificAddress ? 15 : 13;
    const map = L.map(mapContainerRef.current, {
      center: [targetLat, targetLng],
      zoom: initialZoom,
      minZoom: 10,
      maxZoom: 19,
      zoomControl: false,
      attributionControl: false,
    });

    // Single ultra-reliable OSM tile layer with maxNativeZoom: 19 to ensure tiles always load cleanly at all zoom levels
    const layer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      maxNativeZoom: 19,
      attribution: '© OpenStreetMap contributors',
      errorTileUrl: 'https://tile.openstreetmap.org/13/4327/2689.png', // graceful fallback if a single tile is slow
    }).addTo(map);

    tileLayerRef.current = layer;
    mapInstanceRef.current = map;

    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // 3. Handle Map FlyTo on Kiel address change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (hasSpecificAddress) {
      map.flyTo([locationGeo.lat, locationGeo.lng], 15, {
        duration: 1.5,
        easeLinearity: 0.25,
      });
    } else {
      map.setView([KIEL_CENTER_LAT, KIEL_CENTER_LNG], 13);
    }

    setTimeout(() => {
      map.invalidateSize();
    }, 300);
  }, [hasSpecificAddress, locationGeo?.lat, locationGeo?.lng]);

  // 4. Update Incident Marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (!hasSpecificAddress) {
      if (incidentMarkerRef.current) {
        map.removeLayer(incidentMarkerRef.current);
        incidentMarkerRef.current = null;
      }
      return;
    }

    const incidentIconHtml = `
      <div class="relative flex items-center justify-center cursor-pointer" style="width: 48px; height: 48px;">
        <!-- Static outer beacon ring -->
        <div class="absolute w-10 h-10 rounded-full bg-red-500/20 border-2 border-red-500/60 shadow-[0_0_12px_rgba(239,68,68,0.4)]"></div>
        <!-- Inner Core -->
        <div class="relative w-8 h-8 rounded-full bg-gradient-to-tr from-red-600 to-rose-500 border-2 border-white shadow-xl flex items-center justify-center text-white font-extrabold text-sm">
          🔥
        </div>
      </div>
    `;

    const customIncidentIcon = L.divIcon({
      html: incidentIconHtml,
      className: 'incident-marker-container',
      iconSize: [48, 48],
      iconAnchor: [24, 24],
    });

    if (incidentMarkerRef.current) {
      incidentMarkerRef.current.setLatLng([locationGeo.lat, locationGeo.lng]);
    } else {
      const marker = L.marker([locationGeo.lat, locationGeo.lng], {
        icon: customIncidentIcon,
        zIndexOffset: 1000,
      }).addTo(map);

      marker.bindPopup(`
        <div style="font-family: system-ui; min-width: 170px; padding: 2px;">
          <div style="font-weight: 800; font-size: 13px; color: #dc2626; display: flex; align-items: center; gap: 4px;">
            <span>🚨 EINSATZORT (KIEL)</span>
          </div>
          <div style="font-size: 11px; color: #334155; margin-top: 4px; font-weight: 600;">
            ${locationGeo.displayName || 'Kiel'}
          </div>
        </div>
      `);

      incidentMarkerRef.current = marker;
    }
  }, [hasSpecificAddress, locationGeo?.lat, locationGeo?.lng, locationGeo?.displayName]);

  // 5. Update Vehicles and Street Routes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (!hasSpecificAddress || units.length === 0) {
      // Clear all vehicle markers & polylines
      vehicleMarkersRef.current.forEach((marker) => map.removeLayer(marker));
      vehicleMarkersRef.current.clear();
      routePolylinesRef.current.forEach((line) => map.removeLayer(line));
      routePolylinesRef.current.clear();
      return;
    }

    const progressRatio = Math.min(1, Math.max(0, arrivalProgressPercent / 100));

    // Cap rendered polylines to distinct station routes to prevent DOM thrashing when many units (e.g. 100 RTWs)
    const drawnStationRoutes = new Set<string>();

    units.forEach((unit, idx) => {
      const sLat = unit.startLat ?? KIEL_CENTER_LAT;
      const sLng = unit.startLng ?? KIEL_CENTER_LNG;
      const tLat = unit.targetLat ?? targetLat;
      const tLng = unit.targetLng ?? targetLng;

      const stationKey = `${sLat.toFixed(4)},${sLng.toFixed(4)}->${tLat.toFixed(4)},${tLng.toFixed(4)}`;

      // Resolve road geometry: prioritize unit.routePath, then cached routes
      let roadPath = unit.routePath;
      if (!roadPath && cachedRoutesRef.current.has(stationKey)) {
        roadPath = cachedRoutesRef.current.get(stationKey);
      }

      if (!roadPath) {
        // Asynchronously fetch street route and cache it
        getStreetRoute(sLat, sLng, tLat, tLng).then((fetched) => {
          if (fetched && fetched.length > 1) {
            cachedRoutesRef.current.set(stationKey, fetched);
            // Re-render polyline if not yet drawn
            if (!drawnStationRoutes.has(stationKey) && mapInstanceRef.current) {
              const poly = L.polyline(fetched, {
                color: unit.type === 'RTW' ? '#f59e0b' : '#3b82f6',
                weight: 4,
                opacity: 0.8,
              }).addTo(mapInstanceRef.current);
              routePolylinesRef.current.set(unit.id, poly);
            }
          }
        });
        roadPath = [
          [sLat, sLng],
          [tLat, tLng],
        ];
      }

      // Draw street polyline for this route (once per station path)
      if (!drawnStationRoutes.has(stationKey)) {
        drawnStationRoutes.add(stationKey);
        if (!routePolylinesRef.current.has(unit.id)) {
          const polyline = L.polyline(roadPath, {
            color: idx === 0 ? '#ef4444' : unit.type === 'RTW' ? '#f59e0b' : '#3b82f6',
            weight: 4,
            opacity: 0.8,
          }).addTo(map);
          routePolylinesRef.current.set(unit.id, polyline);
        }
      }

      // Compute vehicle's position along the road
      // For convoys with multiple units, add a slight offset so they form a line along the street
      const convoyOffset = units.length > 1 ? Math.min(0.08, (idx % 8) * 0.012) : 0;
      const effectiveRatio = Math.max(0, Math.min(1, progressRatio - convoyOffset));

      let curLat: number;
      let curLng: number;

      if (isArrivalComplete || progressRatio >= 1) {
        // Parked at incident location with small parking grid
        const col = idx % 5;
        const row = Math.floor(idx / 5);
        curLat = tLat + (row * 0.00018 - 0.00036);
        curLng = tLng + (col * 0.00022 - 0.00044);
      } else {
        const [roadLat, roadLng] = getPositionAlongRoute(roadPath, effectiveRatio);
        curLat = roadLat;
        curLng = roadLng;
      }

      // Custom Vehicle HTML Icon
      const isLead = idx === 0;
      const isAmbulance = unit.type === 'RTW' || unit.iconType === 'ambulance';
      const badgeColor = isLead ? 'bg-red-600' : isAmbulance ? 'bg-amber-600' : 'bg-blue-600';

      const vehicleIconHtml = `
        <div class="relative flex flex-col items-center group cursor-pointer" style="width: 44px; height: 50px;">
          <!-- Blue Emergency Beacon (static, no blinking) -->
          <div class="absolute -top-1 w-2.5 h-2.5 rounded-full bg-cyan-400 border border-white shadow-[0_0_6px_#38bdf8]"></div>
          
          <!-- Vehicle Box -->
          <div class="w-8 h-8 rounded-lg ${badgeColor} border-2 border-white shadow-xl flex items-center justify-center text-white font-extrabold text-[11px] transform transition-transform hover:scale-125">
            ${unit.type.slice(0, 3)}
          </div>
          
          <!-- Designation Tag -->
          <div class="mt-0.5 whitespace-nowrap px-1.5 py-0.2 rounded bg-slate-900/90 text-white font-sans text-[9px] font-bold border border-slate-700 shadow-sm">
            ${unit.type || unit.name}
          </div>
        </div>
      `;

      const vehicleIcon = L.divIcon({
        html: vehicleIconHtml,
        className: 'vehicle-marker-container',
        iconSize: [44, 50],
        iconAnchor: [22, 25],
      });

      if (vehicleMarkersRef.current.has(unit.id)) {
        const existingMarker = vehicleMarkersRef.current.get(unit.id)!;
        existingMarker.setLatLng([curLat, curLng]);
      } else {
        const marker = L.marker([curLat, curLng], {
          icon: vehicleIcon,
          zIndexOffset: 800 + idx,
        }).addTo(map);

        marker.bindPopup(`
          <div style="font-family: system-ui; min-width: 170px; padding: 2px;">
            <div style="font-weight: 800; font-size: 12px; color: #1e293b; display: flex; align-items: center; justify-content: space-between;">
              <span>🚨 ${unit.type || unit.name}</span>
            </div>
            <div style="font-size: 11px; color: #475569; margin-top: 3px;">
              ${unit.name}
            </div>
            <div style="font-size: 10px; color: #64748b; margin-top: 4px; border-top: 1px solid #e2e8f0; padding-top: 3px;">
              <div>Wache: <strong>${unit.station}</strong></div>
              <div>Status: <span style="color: #0284c7; font-weight: bold;">${isArrivalComplete ? 'Status 4 - Am Einsatzort' : 'Status 3 - Anfahrt über Straße'}</span></div>
            </div>
          </div>
        `);

        vehicleMarkersRef.current.set(unit.id, marker);
      }
    });

    // Cleanup units that were removed
    const currentUnitIds = new Set(units.map((u) => u.id));
    vehicleMarkersRef.current.forEach((marker, id) => {
      if (!currentUnitIds.has(id)) {
        map.removeLayer(marker);
        vehicleMarkersRef.current.delete(id);
      }
    });
    routePolylinesRef.current.forEach((line, id) => {
      if (!currentUnitIds.has(id)) {
        map.removeLayer(line);
        routePolylinesRef.current.delete(id);
      }
    });
  }, [units, arrivalProgressPercent, isArrivalComplete, hasSpecificAddress, targetLat, targetLng]);

  // Center on Kiel incident location
  const handleCenterOnIncident = () => {
    const map = mapInstanceRef.current;
    if (map) {
      map.flyTo([targetLat, targetLng], 15, { duration: 1.2 });
    }
  };

  // Fit bounds to show all vehicles and incident in Kiel
  const handleFitAll = () => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const bounds = L.latLngBounds([[targetLat, targetLng]]);
    units.forEach((u) => {
      if (u.startLat && u.startLng) bounds.extend([u.startLat, u.startLng]);
      if (u.currentLat && u.currentLng) bounds.extend([u.currentLat, u.currentLng]);
    });
    map.fitBounds(bounds.pad(0.15), { animate: true });
  };

  // Toggle Fullscreen / Expand
  const handleToggleExpand = () => {
    setIsExpanded((prev) => !prev);
    setTimeout(() => {
      mapInstanceRef.current?.invalidateSize();
    }, 250);
  };

  return (
    <div
      id="tactical-emergency-map-root"
      className={`relative w-full rounded-2xl overflow-hidden border border-slate-700/80 bg-slate-900 shadow-xl transition-all duration-300 ${
        isExpanded ? 'h-96 sm:h-[480px]' : 'h-64 sm:h-72'
      }`}
    >
      {/* Leaflet Map Canvas */}
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Top Left: Location Status in Kiel */}
      <div className="absolute top-2.5 left-2.5 z-10 flex flex-col gap-1 pointer-events-auto">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/90 backdrop-blur-md text-white text-xs font-semibold border border-slate-700 shadow-md">
          <span className="w-2 h-2 rounded-full bg-red-500"></span>
          <span className="uppercase tracking-wider text-[11px] text-red-400 font-bold">Kiel</span>
          <span className="text-slate-400">|</span>
          <span className="text-slate-200">
            {locationGeo?.displayName || 'Einsatzgebiet Kiel'}
          </span>
        </div>

        {units.length > 0 && (
          <div className="px-2.5 py-0.5 rounded-md bg-slate-900/80 backdrop-blur-sm text-slate-300 text-[10px] font-mono border border-slate-800">
            {units.length} Einheiten auf Straßenroute • {arrivalProgressPercent}% Anfahrt
          </div>
        )}
      </div>

      {/* Awaiting Street Notification Banner if specific street not yet pinpointed */}
      {!hasSpecificAddress && (
        <div className="absolute inset-x-4 top-14 z-10 pointer-events-none flex justify-center">
          <div className="bg-slate-900/90 text-slate-200 border border-slate-700 backdrop-blur-md px-4 py-2 rounded-xl text-xs font-semibold shadow-2xl flex items-center gap-2 max-w-md">
            <Radio className="w-4 h-4 text-amber-400" />
            <span>Einsatzgebiet Kiel – Disponent erfasst genaue Straße / Adresse</span>
          </div>
        </div>
      )}

      {/* Top Right: Map Controls */}
      <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5 pointer-events-auto">
        <button
          type="button"
          onClick={handleCenterOnIncident}
          className="p-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700 shadow-md transition-colors"
          title="Auf Kiel / Notfallort zentrieren"
        >
          <Crosshair className="w-4 h-4 text-red-400" />
        </button>

        {units.length > 0 && (
          <button
            type="button"
            onClick={handleFitAll}
            className="p-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700 shadow-md transition-colors"
            title="Alle Einsatzkräfte auf Straßen anzeigen"
          >
            <Navigation className="w-4 h-4 text-emerald-400" />
          </button>
        )}

        <button
          type="button"
          onClick={handleToggleExpand}
          className="p-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700 shadow-md transition-colors"
          title={isExpanded ? 'Karte verkleinern' : 'Karte vergrößern'}
        >
          {isExpanded ? <Minimize2 className="w-4 h-4 text-slate-300" /> : <Maximize2 className="w-4 h-4 text-slate-300" />}
        </button>
      </div>

      {/* Bottom Floating Legend Bar */}
      <div className="absolute bottom-2 inset-x-2.5 z-10 pointer-events-auto flex items-center justify-between px-3 py-1.5 rounded-xl bg-slate-950/85 backdrop-blur-md border border-slate-800 text-[11px] text-slate-300 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600 border border-white"></span>
            <span className="font-semibold text-slate-200">Einsatzort</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600 border border-white"></span>
            <span className="font-semibold text-slate-200">Feuerwehr</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-600 border border-white"></span>
            <span className="font-semibold text-slate-200">Rettungsdienst</span>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-slate-400 font-mono text-[10px]">
          <span>🛣️ Straßenrouting Kiel Live</span>
        </div>
      </div>
    </div>
  );
};
