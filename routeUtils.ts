// Utility for road routing along streets and calculating vehicle positions along real street networks

export function haversineDistanceMeters(p1: [number, number], p2: [number, number]): number {
  const R = 6371e3;
  const phi1 = (p1[0] * Math.PI) / 180;
  const phi2 = (p2[0] * Math.PI) / 180;
  const dphi = ((p2[0] - p1[0]) * Math.PI) / 180;
  const dlambda = ((p2[1] - p1[1]) * Math.PI) / 180;
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calculates exact coordinate along a street route polyline for progress ratio t (0.0 to 1.0)
 * Guarantees vehicle stays precisely on the street geometry.
 */
export function getPositionAlongRoute(
  routePath: Array<[number, number]>,
  t: number
): [number, number] {
  if (!routePath || routePath.length === 0) {
    return [54.3233, 10.1228];
  }
  if (routePath.length === 1 || t <= 0) {
    return routePath[0];
  }
  if (t >= 1) {
    return routePath[routePath.length - 1];
  }

  // Pre-calculate distances between road nodes
  const segmentDistances: number[] = [];
  let totalDistance = 0;

  for (let i = 0; i < routePath.length - 1; i++) {
    const dist = haversineDistanceMeters(routePath[i], routePath[i + 1]);
    segmentDistances.push(dist);
    totalDistance += dist;
  }

  if (totalDistance === 0) {
    return routePath[0];
  }

  const targetDistance = t * totalDistance;
  let accumulated = 0;

  for (let i = 0; i < segmentDistances.length; i++) {
    const segDist = segmentDistances[i];
    if (accumulated + segDist >= targetDistance) {
      const segRatio = segDist === 0 ? 0 : (targetDistance - accumulated) / segDist;
      const p1 = routePath[i];
      const p2 = routePath[i + 1];
      const lat = p1[0] + (p2[0] - p1[0]) * segRatio;
      const lng = p1[1] + (p2[1] - p1[1]) * segRatio;
      return [lat, lng];
    }
    accumulated += segDist;
  }

  return routePath[routePath.length - 1];
}

// Client-side cache for fetched street routes
const clientRouteCache = new Map<string, Array<[number, number]>>();

/**
 * Fetches street route between two coordinates via internal proxy /api/route or OSRM
 */
export async function getStreetRoute(
  startLat: number,
  startLng: number,
  targetLat: number,
  targetLng: number
): Promise<Array<[number, number]>> {
  const key = `${startLat.toFixed(4)},${startLng.toFixed(4)}->${targetLat.toFixed(4)},${targetLng.toFixed(4)}`;
  if (clientRouteCache.has(key)) {
    return clientRouteCache.get(key)!;
  }

  try {
    const resp = await fetch(
      `/api/route?startLat=${startLat}&startLng=${startLng}&targetLat=${targetLat}&targetLng=${targetLng}`
    );
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data.coordinates) && data.coordinates.length > 1) {
        clientRouteCache.set(key, data.coordinates);
        return data.coordinates;
      }
    }
  } catch (err) {
    console.warn('Failed to fetch street route from API, trying direct OSRM:', err);
  }

  // Fallback direct OSRM driving
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2800);
    const osrmResp = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${targetLng},${targetLat}?overview=full&geometries=geojson`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (osrmResp.ok) {
      const osrmData = await osrmResp.json();
      const coords = osrmData.routes?.[0]?.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length > 1) {
        const latLngs: Array<[number, number]> = coords.map((c: [number, number]) => [c[1], c[0]]);
        clientRouteCache.set(key, latLngs);
        return latLngs;
      }
    }
  } catch (e) {
    console.warn('Direct OSRM fallback failed:', e);
  }

  // Emergency fallback: direct line
  const direct: Array<[number, number]> = [
    [startLat, startLng],
    [targetLat, targetLng],
  ];
  clientRouteCache.set(key, direct);
  return direct;
}
