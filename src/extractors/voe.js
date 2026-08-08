const { get, client, BROWSER_HEADERS } = require("../util/http");
const { captureStream, isAvailable } = require("../util/browser");

// voe.sx extractor.
//
// Voe embeds its stream behind an ad-redirect + an obfuscated JWPlayer config.
// Flow:
//   1. A voe.sx/<id> link returns a tiny HTML page that JS-redirects through an
//      ad domain (e.g. stevenfamilyedge.com/<id>) — that target IS the player.
//   2. The player page stores the m3u8/mp4 inside a heavily obfuscated blob
//      (rotating variable names, base64 + string-array packer). The obfuscation
//      changes over time, so static decoding is brittle.
//
// Strategy:
//   - Try to resolve the redirect chain with axios and grep the player HTML for
//     any plainly-visible m3u8/mp4 (works when voe briefly exposes it).
//   - Otherwise, when a headless browser is available (USE_PUPPETEER=true),
//     render the player and capture the media request. Degrades gracefully.

const VOE = "https://voe.sx";

/**
 * Resolve a voe.sx id (or full URL) to its player page URL by following the
 * inline JS redirect.
 */
async function resolvePlayerUrl(idOrUrl) {
    const url = idOrUrl.startsWith("http")
        ? idOrUrl
        : `${VOE}/${idOrUrl.replace(/^\/+/, "")}`;

    // The watch page redirects via JS. We fetch it and pull the target out.
    const html = await get(url).catch(() => "");
    const m = html.match(/https?:\/\/[a-z0-9-]+\.[a-z]{2,}\/[a-z0-9_-]+/i);
    // The first external domain in the redirect that isn't voe itself is the player.
    if (m) {
        const target = m[0];
        if (!target.includes("voe.sx")) return target;
    }
    // Fallback: try the /e/<id> embed which sometimes returns the player directly.
    return `${VOE}/e/${(idOrUrl.match(/[a-z0-9_-]+$/i) || [""])[0]}`;
}

/**
 * @returns {Promise<Array<{url, type, quality, referer}>>}
 */
async function extractVoe(idOrUrl) {
    const results = [];

    // 1. Static attempt: fetch player HTML and look for a visible stream URL.
    try {
        const playerUrl = await resolvePlayerUrl(idOrUrl);
        const html = await get(playerUrl, { headers: { Referer: VOE + "/" } });

        // Some voe builds momentarily expose the URL in the markup/JSON.
        const urls = new Set();
        const re = /https?:\/\/[^"'\s<>]+?\.(?:m3u8|mp4)(?:\?[^"'\s<>]*)?/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
            const u = m[0];
            // Filter out the known decoy trailer.
            if (u.includes("test-videos.co.uk") || u.includes("bigbuckbunny")) continue;
            urls.add(u);
        }
        for (const u of urls) {
            results.push({
                url: u,
                type: /\.m3u8$/i.test(u) ? "hls" : "mp4",
                quality: "Auto",
                referer: playerUrl
            });
        }
    } catch (e) {
        // fall through to browser capture
    }

    if (results.length) return results;

    // 2. Headless-browser capture (most reliable, needs USE_PUPPETEER=true).
    if (isAvailable()) {
        try {
            const playerUrl = await resolvePlayerUrl(idOrUrl);
            const hit = await captureStream(playerUrl, {
                referer: VOE + "/",
                prefer: "hls",
                timeoutMs: 25000
            });
            if (hit) {
                results.push({
                    url: hit.url,
                    type: hit.type,
                    quality: "Auto",
                    referer: playerUrl
                });
            }
        } catch (e) {
            // graceful degradation
        }
    }

    return results;
}

module.exports = { extractVoe };
