const cheerio = require("cheerio");
const { get } = require("./util/http");
const { cached } = require("./util/cache");

const BASE_URL = "https://turkish123.pro";
const ID_PREFIX = "turkish123";

// Catalog of all series: fetched from /series-list/ (single page, no pagination)
// and cached for a while so repeated Stremio refreshes stay snappy.
const CATALOG_TTL = 30 * 60 * 1000; // 30 min

/**
 * Scrape the full series list from /series-list/.
 * Returns [{ id, type, name, poster, slug }].
 */
async function fetchSeriesList() {
    return cached("series-list", CATALOG_TTL, async () => {
        const html = await get(`${BASE_URL}/series-list/`);
        const $ = cheerio.load(html);
        const series = [];
        const seen = new Set();

        $(".ml-item").each((_, el) => {
            const $el = $(el);
            const anchor = $el.find("a.ml-mask").first();
            const href = anchor.attr("href") || "";
            const slug = href.replace(/\/$/, "").split("/").pop();
            if (!slug || seen.has(slug)) return;
            seen.add(slug);

            const name = $el.find(".mli-info h2").first().text().trim()
                || $el.find("img.mli-thumb").attr("alt")?.trim()
                || slug.replace(/-/g, " ");

            let poster = $el.find("img.mli-thumb").attr("src") || "";
            if (poster && !poster.startsWith("http")) {
                poster = BASE_URL + (poster.startsWith("/") ? "" : "/") + poster;
            }

            series.push({
                id: `${ID_PREFIX}:${slug}`,
                type: "series",
                name,
                poster,
                slug
            });
        });

        return series;
    });
}

/**
 * Catalog handler. Supports optional ?search= via the WordPress ?s= endpoint,
 * otherwise returns the full list (new shows appear automatically).
 */
async function getSeries(extra = {}) {
    if (extra.search) {
        return searchSeries(extra.search);
    }
    const series = await fetchSeriesList();
    return series;
}

// Search the source site. It uses the same .ml-item card markup.
async function searchSeries(query) {
    return cached(`search:${query.toLowerCase()}`, 5 * 60 * 1000, async () => {
        const html = await get(`${BASE_URL}/?s=${encodeURIComponent(query)}`);
        const $ = cheerio.load(html);
        const results = [];
        const seen = new Set();

        $(".ml-item").each((_, el) => {
            const $el = $(el);
            const href = $el.find("a.ml-mask").first().attr("href") || "";
            const slug = href.replace(/\/$/, "").split("/").pop();
            if (!slug || seen.has(slug)) return;
            seen.add(slug);

            const name = $el.find(".mli-info h2").first().text().trim()
                || $el.find("img.mli-thumb").attr("alt")?.trim()
                || slug.replace(/-/g, " ");

            let poster = $el.find("img.mli-thumb").attr("src") || "";
            if (poster && !poster.startsWith("http")) {
                poster = BASE_URL + (poster.startsWith("/") ? "" : "/") + poster;
            }

            results.push({
                id: `${ID_PREFIX}:${slug}`,
                type: "series",
                name,
                poster,
                slug
            });
        });

        return results;
    });
}

// Resolve a series id like "turkish123:yemin" to its slug.
function idToSlug(id) {
    const parts = id.split(":");
    return parts[1] || "";
}

/**
 * Meta handler. Scrapes the show page to build the episode list with correct
 * season/episode numbers, plus poster/description/genres.
 *
 * Seasons are encoded inline: an episode link may contain a
 *   <span class="gllac">Season N</span>  -> this episode is the FIRST of season N
 *   <span class="gllac">End of Season N</span>  -> this episode is the LAST of season N
 * Episodes with no marker keep the current season.
 */
async function getMeta(type, id) {
    const slug = idToSlug(id);
    if (!slug) return { meta: null };

    const seriesList = await fetchSeriesList().catch(() => []);
    const basic = seriesList.find((s) => s.slug === slug);

    return cached(`meta:${slug}`, CATALOG_TTL, async () => {
        const html = await get(`${BASE_URL}/${slug}/`);
        const $ = cheerio.load(html);

        const name = $('h1[itemprop="name"]').first().text().trim()
            || basic?.name
            || slug.replace(/-/g, " ");

        let poster = $('img[itemprop="image"]').first().attr("src")
            || $(".mli-thumb").first().attr("src")
            || basic?.poster
            || "";
        if (poster && !poster.startsWith("http")) {
            poster = BASE_URL + (poster.startsWith("/") ? "" : "/") + poster;
        }

        const description = $(".f-desc").first().text().trim()
            || $('[itemprop="description"]').first().text().trim()
            || "";

        // Scope metadata to the .mvic-info block so we only pick up THIS show's
        // genres/actors/years (not nav/footer/recommendation links).
        const info = $(".mvic-info").first();

        const genres = [];
        info.find('a[href*="/genre/"]').each((_, a) => {
            const g = $(a).text().trim();
            if (g && !genres.includes(g)) genres.push(g);
        });

        const year = info.find('a[href*="/year/"]').first().text().trim() || undefined;
        const imdbRating = $('[itemprop="ratingValue"]').first().text().trim() || undefined;
        const runtime = info.find('[itemprop="duration"]').first().text().trim() || undefined;

        // Cast/director
        const cast = [];
        info.find('a[href*="/actor/"]').each((_, a) => {
            const c = $(a).text().trim();
            if (c) cast.push(c);
        });
        const director = info.find('a[href*="/director/"]').first().text().trim() || undefined;

        // Build episode list with season mapping.
        const videos = [];
        let currentSeason = 1;
        let episodeInSeason = 0;
        const seenEp = new Set();

        $("a.episodi").each((_, el) => {
            const $el = $(el);
            const href = $el.attr("href") || "";
            const match = href.match(/-episode-(\d+)\/?$/);
            if (!match) return;
            const absNumber = parseInt(match[1], 10);
            if (seenEp.has(absNumber)) return;
            seenEp.add(absNumber);

            // A "Season N" marker on this link means season N begins here.
            const seasonMarker = $el.find(".gllac").first().text().trim();
            const startMatch = seasonMarker.match(/^Season\s+(\d+)/i);
            if (startMatch) {
                currentSeason = parseInt(startMatch[1], 10);
                episodeInSeason = 0;
            }
            episodeInSeason += 1;

            videos.push({
                id: `${ID_PREFIX}:${slug}:${absNumber}`,
                title: `${name} - Episode ${absNumber}`,
                season: currentSeason,
                episode: episodeInSeason,
                thumbnail: poster,
                overview: ""
            });
        });

        const meta = {
            id: `${ID_PREFIX}:${slug}`,
            type: "series",
            name,
            poster,
            background: poster,
            description,
            genres: genres.length ? genres : undefined,
            year,
            imdbRating,
            runtime,
            cast: cast.length ? cast : undefined,
            director,
            videos
        };

        // Strip undefined values for a clean payload.
        Object.keys(meta).forEach((k) => meta[k] === undefined && delete meta[k]);
        return { meta };
    });
}

module.exports = { getSeries, getMeta, fetchSeriesList, ID_PREFIX, BASE_URL };
