const { get } = require("./util/http");
const { cached } = require("./util/cache");
const { ID_PREFIX, BASE_URL } = require("./catalog");
const { parseEpisodeSources, extract } = require("./extractors");
const { getYoutubeStreams } = require("./util/youtube");

function addonOrigin() {
    return (
        process.env.RENDER_EXTERNAL_URL ||
        `http://127.0.0.1:${process.env.PORT || 7000}`
    );
}

function proxyUrl(target, referer) {
    const origin = addonOrigin();
    const params = new URLSearchParams();
    params.set("url", target);
    if (referer) params.set("referer", referer);
    return `${origin}/proxy?${params.toString()}`;
}

/**
 * id format: "turkish123:<slug>:<absEpisode>".
 * Retourne les flux turkish123 + les flux YouTube officiels.
 * Chaque source échoue indépendamment de l'autre.
 */
async function getStream(type, id) {
    const parts = id.split(":");
    if (parts.length < 3) return { streams: [] };
    const slug = parts[1];
    const absEpisode = parts.slice(2).join(":");
    if (!slug || !/^\d+$/.test(absEpisode)) return { streams: [] };

    const [t123, youtube] = await Promise.all([
        cached(
            `streams:${slug}:${absEpisode}`,
            10 * 60 * 1000,
            () => resolveStreams(slug, absEpisode),
            (result) => result && result.streams && result.streams.length > 0
        ).catch((e) => {
            console.error("turkish123:", e.message);
            return { streams: [] };
        }),
        getYoutubeStreams(slug, absEpisode).catch((e) => {
            console.error("YouTube:", e.message);
            return [];
        })
    ]);

    return { streams: [...(t123.streams || []), ...youtube] };
}

async function resolveStreams(slug, absEpisode) {
    const episodeUrl = `${BASE_URL}/${slug}-episode-${absEpisode}/`;
    const html = await cached(
        `episode:${slug}:${absEpisode}`,
        5 * 60 * 1000,
        () => get(episodeUrl)
    );

    const sources = parseEpisodeSources(html);
    if (!sources.length) return { streams: [] };

    const settled = await Promise.allSettled(
        sources.map(async (s) => ({ source: s, streams: await extract(s) }))
    );

    const streams = [];
    let index = 0;
    for (const res of settled) {
        if (res.status !== "fulfilled") continue;
        const { source, streams: extracted } = res.value;
        for (const ex of extracted) {
            index += 1;
            const isHls = ex.type === "hls" || /\.m3u8/i.test(ex.url);
            const hostLabel = hostLabelFor(source.host);

            if (isHls) {
                streams.push({
                    name: `${hostLabel} ${ex.quality || ""}`.trim(),
                    title: `Source ${index}: ${hostLabel} (${ex.quality || "HLS"})`,
                    url: proxyUrl(ex.url, ex.referer),
                    behaviorHints: {
                        notWebReady: true,
                        headers: ex.referer ? { Referer: ex.referer } : undefined
                    }
                });
            } else {
                streams.push({
                    name: `${hostLabel} ${ex.quality || ""}`.trim(),
                    title: `Source ${index}: ${hostLabel} (${ex.quality || "MP4"})`,
                    url: ex.url,
                    behaviorHints: {
                        notWebReady: true,
                        proxyHeaders: ex.referer
                            ? { request: { Referer: ex.referer } }
                            : undefined
                    }
                });
            }
        }
    }

    return { streams };
}

function hostLabelFor(host) {
    switch (host) {
        case "engifuosi":
        case "tokvoy":
            return "Turkish123";
        case "vidmoly":
            return "Vidmoly";
        case "voe":
            return "Voe";
        default:
            return host;
    }
}

module.exports = { getStream };
