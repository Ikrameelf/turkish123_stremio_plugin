const axios = require("axios");
const { cached } = require("./cache");

const API = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";
const TTL = 24 * 60 * 60 * 1000; // 24 h
const KEY = process.env.TMDB_API_KEY;
const LANG = process.env.TMDB_LANG || "fr-FR";

async function tmdb(path, params = {}) {
    const { data } = await axios.get(API + path, {
        params: { api_key: KEY, language: LANG, ...params },
        timeout: 10000
    });
    return data;
}

// Retrouve la série sur TMDB à partir du nom du site
async function findShow(name, year) {
    const clean = name.replace(/\(.*?\)/g, "").trim();
    return cached(`tmdb-find:${clean}:${year || ""}`, TTL, async () => {
        const res = await tmdb("/search/tv", { query: clean });
        const list = res.results || [];
        const best =
            list.find((r) => r.origin_country?.includes("TR") &&
                year && (r.first_air_date || "").startsWith(year)) ||
            list.find((r) => r.origin_country?.includes("TR")) ||
            list[0];
        return best ? best.id : null;
    });
}

// Détails de la série + toutes les saisons
async function getDetails(tmdbId) {
    return cached(`tmdb-details:${tmdbId}`, TTL, async () => {
        const show = await tmdb(`/tv/${tmdbId}`, { append_to_response: "credits" });
        const seasons = await Promise.all(
            (show.seasons || [])
                .filter((s) => s.season_number > 0)
                .map((s) => tmdb(`/tv/${tmdbId}/season/${s.season_number}`))
        );
        const episodes = seasons.flatMap((s) =>
            (s.episodes || []).map((e) => ({ ...e, season_number: s.season_number }))
        );
        return { show, episodes };
    });
}

async function enrichMeta(meta, year) {
    if (!KEY) return meta;
    const tmdbId = await findShow(meta.name, year);
    if (!tmdbId) return meta;

    const { show, episodes } = await getDetails(tmdbId);

    if (show.overview) meta.description = show.overview;
    if (show.poster_path) meta.poster = `${IMG}/w500${show.poster_path}`;
    if (show.backdrop_path) meta.background = `${IMG}/w1280${show.backdrop_path}`;
    if (show.genres?.length) meta.genres = show.genres.map((g) => g.name);
    if (show.vote_average) meta.imdbRating = show.vote_average.toFixed(1);
    if (show.first_air_date) meta.year = show.first_air_date.slice(0, 4);
    const cast = (show.credits?.cast || []).slice(0, 10).map((c) => c.name);
    if (cast.length) meta.cast = cast;

    // Association des épisodes : même nombre => par ordre, sinon par saison/épisode
    const sameCount = episodes.length === meta.videos.length;
    meta.videos.forEach((v, i) => {
        const ep = sameCount
            ? episodes[i]
            : episodes.find((e) => e.season_number === v.season && e.episode_number === v.episode);
        if (!ep) return;
        if (ep.name) v.title = ep.name;
        if (ep.overview) v.overview = ep.overview;
        if (ep.still_path) v.thumbnail = `${IMG}/w300${ep.still_path}`;
        if (ep.air_date) v.released = new Date(ep.air_date).toISOString();
    });
    return meta;
}

// Infos utiles pour la recherche YouTube : nom original + chaînes de diffusion
async function getShowInfo(name) {
    if (!KEY) return null;
    const id = await findShow(name);
    if (!id) return null;
    const { show } = await getDetails(id);
    return {
        originalName: show.original_name,
        companies: [
            ...(show.networks || []).map((n) => n.name),
            ...(show.production_companies || []).map((c) => c.name)
        ]
    };
}

module.exports = { enrichMeta, getShowInfo };
