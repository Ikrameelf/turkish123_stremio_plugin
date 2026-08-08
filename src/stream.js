const { get } = require("./util/http");
const { cached } = require("./util/cache");
const { ID_PREFIX, BASE_URL } = require("./catalog");
const { parseEpisodeSources, extract } = require("./extractors");

// The absolute origin of THIS addon, used to wrap HLS streams through /proxy.
// On Render, RENDER_EXTERNAL_URL is set to the public URL; locally we fall back.
function addonOrigin() {
    return (
        process.env.RENDER_EXTERNAL_URL ||
        `http://127.0.0.1:${process.env.PORT || 7000}`
    );
}

// Wrap a stream URL + referer through our /proxy route. HLS playlists need this
// so the player sends the correct Referer to the CDN and so segment URLs are
// rewritten to stay proxied.
function proxyUrl(target, referer) {
    const origin = addonOrigin();
    const params = new URLSearchParams();
    params.set("url", target);
    if (referer) params.set("referer", referer);
    return `${origin}/proxy?${params.toString()}`;
}

/**
 * Stream handler. id format: "turkish123:<slug>:<absEpisode>".
 *
 * Fetches the episode page, parses the Server 1/2/3 download links, runs every
 * available extractor (all in parallel), and returns one Stremio stream per
 * resolved URL. tokvoy (engifuosi) is the reliable primary; voe/vidmoly are
 * best-effort extras.
 */
async function getStream(type, id) {
    const parts = id.split(":");
    if (parts.length < 3) return { streams: [] };
    const slug = parts[1];
    const absEpisode = parts.slice(2).join(":"); // absolute episode number
    if (!slug || !/^\d+$/.test(absEpisode)) return { streams: [] };

    // Fetch the episode page (cached briefly so repeated stream clicks are fast).
    const episodeUrl = `${BASE_URL}/${slug}-episode-${absEpisode}/`;
    const html = await cached(
        `episode:${slug}:${absEpisode}`,
        5 * 60 * 1000,
        () => get(episodeUrl)
    );

    const sources = parseEpisodeSources(html);
    if (!sources.length) return { streams: [] };

    // Run all extractors in parallel; collect whatever resolves.
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
                // HLS needs the proxy for referer + playlist rewriting.
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
                // Direct progressive .mp4. Send the raw CDN URL with proxyHeaders
                // so Stremio injects the Referer the CDN checks.
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

    if (!streams.length) {
        // Helpful diagnostic surfaced in Stremio's stream list.
        streams.push({
            name: "No sources",
            title: "Turkish123: no stream could be resolved for this episode",
            url: "about:blank",
            behaviorHints: { notWebReady: true }
        });
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
