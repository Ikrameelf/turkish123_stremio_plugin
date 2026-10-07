const axios = require("axios");
const { cached } = require("./cache");
const { fetchSeriesList } = require("../catalog");
const { getShowInfo } = require("./tmdb");

const API = "https://www.googleapis.com/youtube/v3";
const KEY = process.env.YOUTUBE_API_KEY;
const TTL = 12 * 60 * 60 * 1000; // 12 h (une recherche coûte 100 unités de quota)

// Chaînes officielles toujours acceptées, en plus de celles trouvées via TMDB.
// Tu peux en ajouter dans Render : YOUTUBE_EXTRA_CHANNELS="Nom 1,Nom 2"
const DEFAULT_CHANNELS = [
    "show tv", "star tv", "atv", "kanal d", "trt 1", "trt",
    "now", "tv8", "kanal 7", "fox"
];

// minuscules, sans accents, ponctuation -> espaces
const norm = (s) =>
    (s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/ı/g, "i")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

function decode(s) {
    return (s || "")
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"');
}

async function search(q) {
    const { data } = await axios.get(API + "/search", {
        params: { key: KEY, part: "snippet", q, type: "video", maxResults: 15 },
        timeout: 10000
    });
    return (data.items || []).map((it) => ({
        id: it.id?.videoId,
        title: decode(it.snippet?.title),
        channel: it.snippet?.channelTitle || ""
    }));
}

// Numéro d'épisode dans le titre ("150. Bölüm", "Episode 150"...)
function episodeNumber(title) {
    const n = norm(title);
    let m = n.match(/\b(\d{1,4}) (bolum|episode|ep)\b/);
    if (m) return parseInt(m[1], 10);
    m = n.match(/\b(bolum|episode|ep) (\d{1,4})\b/);
    if (m) return parseInt(m[2], 10);
    return null;
}

// La chaîne est-elle dans la liste officielle ? (comparaison par mots entiers)
function isOfficial(channelTitle, names) {
    const c = ` ${norm(channelTitle)} `;
    return names.some((n) => n && c.includes(` ${norm(n)} `));
}

// Prépare la requête : nom original (TMDB), chaînes officielles, texte cherché
async function prepare(slug, absEpisode) {
    const list = await fetchSeriesList().catch(() => []);
    const siteName = list.find((s) => s.slug === slug)?.name || slug.replace(/-/g, " ");
    const cleanSite = siteName.replace(/\(.*?\)/g, "").trim();

    const info = await getShowInfo(cleanSite).catch(() => null);
    const originalName = info?.originalName || cleanSite;

    const extra = (process.env.YOUTUBE_EXTRA_CHANNELS || "")
        .split(",").map((s) => s.trim()).filter(Boolean);
    const officialNames = [...DEFAULT_CHANNELS, ...(info?.companies || []), ...extra];

    const wanted = parseInt(absEpisode, 10);
    const q = `${originalName} ${wanted}. Bölüm`;
    const keys = [norm(originalName), norm(cleanSite)].filter(Boolean);

    return { cleanSite, originalName, officialNames, wanted, q, keys, tmdbFound: !!info };
}

async function getYoutubeStreams(slug, absEpisode) {
    if (!KEY) {
        console.log("YouTube: YOUTUBE_API_KEY manquante");
        return [];
    }

    const p = await prepare(slug, absEpisode);
    const results = await cached(`yt-search:${p.q}`, TTL, () => search(p.q));

    console.log("YT query:", p.q, "| officiel:", p.officialNames.join(", "));
    console.log(
        "YT results:\n" +
        (results.map((v) => `${v.channel} | ${v.title}`).join("\n") || "(aucun résultat)")
    );

    return results
        .filter((v) => {
            if (!v.id) return false;
            const t = norm(v.title);
            if (/fragman|trailer|teaser|promo|ozet|best of/.test(t)) return false;
            if (!p.keys.some((k) => t.includes(k))) return false;
            if (episodeNumber(v.title) !== p.wanted) return false;
            return isOfficial(v.channel, p.officialNames);
        })
        .slice(0, 2)
        .map((v) => ({
            name: "YouTube",
            title: `▶ YouTube officiel\n${v.title}\n(${v.channel})`,
            ytId: v.id
        }));
}

// Diagnostic : affiche tout ce qui se passe, vidéo par vidéo
async function debugYoutube(slug, absEpisode) {
    const out = {
        youtubeKeyPresent: !!KEY,
        tmdbKeyPresent: !!process.env.TMDB_API_KEY
    };
    try {
        const p = await prepare(slug, absEpisode);
        out.tmdbFound = p.tmdbFound;
        out.originalName = p.originalName;
        out.query = p.q;
        out.officialChannels = p.officialNames;

        const results = await search(p.q);
        out.resultCount = results.length;
        out.results = results.map((v) => {
            const t = norm(v.title);
            return {
                channel: v.channel,
                title: v.title,
                seriesNameInTitle: p.keys.some((k) => t.includes(k)),
                episodeNumberFound: episodeNumber(v.title),
                officialChannel: isOfficial(v.channel, p.officialNames)
            };
        });
    } catch (e) {
        out.error = e.response?.data?.error?.message || e.message;
    }
    return out;
}

module.exports = { getYoutubeStreams, debugYoutube };
