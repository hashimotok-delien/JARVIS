/** Open-Meteo geocoding (no API key required) for the weather location. */

export interface GeoPlace {
  name: string;
  admin1?: string;
  country?: string;
  lat: number;
  lon: number;
}

interface LocalCity {
  name: string;
  romaji: string;
  lat: number;
  lon: number;
}

/**
 * Prefectural capitals. Open-Meteo only knows long forms ("大阪市"), so a
 * local table makes short Japanese queries instant and offline.
 */
const JP_CITIES: LocalCity[] = [
  { name: "札幌", romaji: "sapporo", lat: 43.0618, lon: 141.3545 },
  { name: "青森", romaji: "aomori", lat: 40.8244, lon: 140.7406 },
  { name: "盛岡", romaji: "morioka", lat: 39.7036, lon: 141.1527 },
  { name: "仙台", romaji: "sendai", lat: 38.2682, lon: 140.8694 },
  { name: "秋田", romaji: "akita", lat: 39.7186, lon: 140.1024 },
  { name: "山形", romaji: "yamagata", lat: 38.2554, lon: 140.3396 },
  { name: "福島", romaji: "fukushima", lat: 37.7608, lon: 140.4747 },
  { name: "水戸", romaji: "mito", lat: 36.3659, lon: 140.4712 },
  { name: "宇都宮", romaji: "utsunomiya", lat: 36.5551, lon: 139.8828 },
  { name: "前橋", romaji: "maebashi", lat: 36.3911, lon: 139.0608 },
  { name: "さいたま", romaji: "saitama", lat: 35.8617, lon: 139.6455 },
  { name: "千葉", romaji: "chiba", lat: 35.6074, lon: 140.1065 },
  { name: "東京", romaji: "tokyo", lat: 35.6895, lon: 139.6917 },
  { name: "横浜", romaji: "yokohama", lat: 35.4437, lon: 139.638 },
  { name: "新潟", romaji: "niigata", lat: 37.9161, lon: 139.0364 },
  { name: "富山", romaji: "toyama", lat: 36.6953, lon: 137.2113 },
  { name: "金沢", romaji: "kanazawa", lat: 36.5613, lon: 136.6562 },
  { name: "福井", romaji: "fukui", lat: 36.0641, lon: 136.2196 },
  { name: "甲府", romaji: "kofu", lat: 35.6642, lon: 138.5684 },
  { name: "長野", romaji: "nagano", lat: 36.6486, lon: 138.1948 },
  { name: "岐阜", romaji: "gifu", lat: 35.4233, lon: 136.7606 },
  { name: "静岡", romaji: "shizuoka", lat: 34.9756, lon: 138.3828 },
  { name: "名古屋", romaji: "nagoya", lat: 35.1815, lon: 136.9066 },
  { name: "津", romaji: "tsu", lat: 34.7303, lon: 136.5086 },
  { name: "大津", romaji: "otsu", lat: 35.0179, lon: 135.8546 },
  { name: "京都", romaji: "kyoto", lat: 35.0116, lon: 135.7681 },
  { name: "大阪", romaji: "osaka", lat: 34.6937, lon: 135.5023 },
  { name: "神戸", romaji: "kobe", lat: 34.6901, lon: 135.1955 },
  { name: "奈良", romaji: "nara", lat: 34.6851, lon: 135.8048 },
  { name: "和歌山", romaji: "wakayama", lat: 34.2305, lon: 135.1708 },
  { name: "鳥取", romaji: "tottori", lat: 35.5011, lon: 134.2351 },
  { name: "松江", romaji: "matsue", lat: 35.4723, lon: 133.0505 },
  { name: "岡山", romaji: "okayama", lat: 34.6618, lon: 133.9344 },
  { name: "広島", romaji: "hiroshima", lat: 34.3853, lon: 132.4553 },
  { name: "山口", romaji: "yamaguchi", lat: 34.1859, lon: 131.4706 },
  { name: "徳島", romaji: "tokushima", lat: 34.0658, lon: 134.5593 },
  { name: "高松", romaji: "takamatsu", lat: 34.3428, lon: 134.0466 },
  { name: "松山", romaji: "matsuyama", lat: 33.8392, lon: 132.7657 },
  { name: "高知", romaji: "kochi", lat: 33.5597, lon: 133.5311 },
  { name: "福岡", romaji: "fukuoka", lat: 33.5904, lon: 130.4017 },
  { name: "佐賀", romaji: "saga", lat: 33.2494, lon: 130.2988 },
  { name: "長崎", romaji: "nagasaki", lat: 32.7503, lon: 129.8777 },
  { name: "熊本", romaji: "kumamoto", lat: 32.8031, lon: 130.7079 },
  { name: "大分", romaji: "oita", lat: 33.2382, lon: 131.6126 },
  { name: "宮崎", romaji: "miyazaki", lat: 31.9077, lon: 131.4202 },
  { name: "鹿児島", romaji: "kagoshima", lat: 31.5966, lon: 130.5571 },
  { name: "那覇", romaji: "naha", lat: 26.2124, lon: 127.6809 },
];

/** Shortcuts shown as chips in the settings screen. */
export const MAJOR_CITIES: GeoPlace[] = [
  "東京",
  "大阪",
  "名古屋",
  "札幌",
  "仙台",
  "広島",
  "福岡",
  "那覇",
].flatMap((name) => {
  const city = JP_CITIES.find((item) => item.name === name);
  return city
    ? [{ name: city.name, country: "日本", lat: city.lat, lon: city.lon }]
    : [];
});

const cache = new Map<string, GeoPlace[]>();

interface GeoResponse {
  results?: Array<{
    name: string;
    admin1?: string;
    country?: string;
    latitude: number;
    longitude: number;
  }>;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function localMatches(query: string): GeoPlace[] {
  const value = normalize(query);
  if (!value) return [];
  return JP_CITIES.filter(
    (city) =>
      normalize(city.name).includes(value) ||
      city.romaji.includes(value) ||
      value.includes(normalize(city.name)),
  )
    .slice(0, 6)
    .map((city) => ({
      name: city.name,
      country: "日本",
      lat: city.lat,
      lon: city.lon,
    }));
}

async function fetchPlaces(query: string): Promise<GeoPlace[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query.trim());
  url.searchParams.set("count", "6");
  url.searchParams.set("language", "ja");
  url.searchParams.set("format", "json");

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as GeoResponse;
  return (data.results ?? []).map((item) => ({
    name: item.name,
    admin1: item.admin1,
    country: item.country,
    lat: item.latitude,
    lon: item.longitude,
  }));
}

const JAPANESE = /[\u3040-\u30ff\u4e00-\u9fff]/;

async function remoteSearch(query: string): Promise<GeoPlace[]> {
  const attempts = [query];
  // Open-Meteo stores "大阪市" / "東京都", not the short form.
  if (JAPANESE.test(query)) attempts.push(`${query}市`, `${query}都`);

  for (const attempt of attempts) {
    const places = await fetchPlaces(attempt);
    if (places.length > 0) return places;
  }
  return [];
}

export async function searchPlaces(query: string): Promise<GeoPlace[]> {
  const key = normalize(query);
  if (!key) return [];
  const cached = cache.get(key);
  if (cached) return cached;

  const local = localMatches(query);
  const places = local.length > 0 ? local : await remoteSearch(query);
  cache.set(key, places);
  return places;
}

