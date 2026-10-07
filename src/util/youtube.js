const axios = require("axios");
const { cached } = require("./cache");
const channels = require("../youtube-channels.json");

const API = "https://www.googleapis.com/youtube/v3";
const KEY = process.env.YOUTUBE_API_KEY;
const TTL = 6 * 60 * 60 * 1000; // 6 h (économise le quota)
const MAX_PAGES = 20; // 20 x 50 = 1000 vidéos max par chaîne

// minuscules + sans accents (ş->s, ğ->g, ı->i...)
const norm = (s) =>
    (s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/ı/g, "i")
        .toLowerCase();

async function yt(path, params) {
    const { data } = await axios.get(API + path, {
        params: { key: KEY, ...params },
        timeout: 10000
    });
    return data;
}

// Trouve la playlist qui contient toutes les vidéos de la chaîne
async function getPlaylistId(cfg) {
    if (cfg.playlistId) return cfg.playlistId;
    if (cfg.channelId) return "UU" + cfg.channelId.slice(2);
    if (cfg.handle) {
        const d = await yt("/channels", {
            part: "contentDetails",
            forHandle: cfg.handle
        });
        return d.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || null;
    }
    return null;
}

async function listVideos(playlistId) {
    return cached(`yt-list:${playlistId}`, TTL, async () => {
        const out = [];
        let pageToken;
        for (let i = 0; i < MAX_PAGES; i++) {
            const d = await yt("/playlistItems", {
                part: "snippet",
                playlistId,
                maxResults: 50,
                pageToken
            });
            for (const it of d.items || []) {
                const s = it.snippet || {};
                const id = s.resourceId?.videoId;
                if (id && s.title !== "Private video" && s.title !== "Deleted video") {
                    out.push({ id, title: s.title });
                }
            }
            pageToken = d.nextPageToken;
            if (!pageToken) break;
        }
        return out;
    });
}

// Extrait le numéro d'épisode d'un titre ("150. Bölüm", "Episode 150"...)
function episodeNumber(title) {
    const n = norm(title);
    let m = n.match(/\b(\d{1,4})\s*\.?\s*(bolum|episode|ep)\b/);
    if (m) return parseInt(m[1], 10);
    m = n.match(/\b(bolum|episode|ep)\s*\.?\s*(\d{1,4})\b/);
    if (m) return parseInt(m[2], 10);
    return null;
}

async function getYoutubeStreams(slug, absEpisode) {
    const cfg = channels[slug];
    if (!KEY || !cfg) return [];

    const playlistId = await cached(`yt-pl:${slug}`, TTL, () => getPlaylistId(cfg));
    if (!playlistId) return [];

    const videos = await listVideos(playlistId);
    const match = norm(cfg.match || "");
    const wanted = parseInt(absEpisode, 10);

    return videos
        .filter((v) => {
            const t = norm(v.title);
            if (match && !t.includes(match)) return false;
            if (/fragman|trailer|teaser|promo/.test(t)) return false;
            return episodeNumber(v.title) === wanted;
        })
        .slice(0, 3)
        .map((v) => ({
            name: "YouTube",
            title: `▶ YouTube officiel\n${v.title}`,
            ytId: v.id
        }));
}

module.exports = { getYoutubeStreams };
