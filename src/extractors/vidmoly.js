const { get } = require("../util/http");
const { captureStream, isAvailable } = require("../util/browser");

// vidmoly.me extractor.
//
// vidmoly is behind Cloudflare and 403s plain HTTP clients. Two cases:
//   - If the page is reachable (e.g. via a browser-issued cf-clearance cookie),
//     its player embeds a `sources:` array (JWPlayer) or a direct .mp4/.m3u8.
//   - Otherwise we need a headless browser to solve the challenge and capture
//     the media request.
//
// As with voe, this degrades gracefully so the addon still works via tokvoy.

const VIDMOLY = "https://vidmoly.me";

/**
 * @param {string} idOrUrl  e.g. "https://vidmoly.me/dl/<id>" or just "<id>"
 * @returns {Promise<Array<{url, type, quality, referer}>>}
 */
async function extractVidmoly(idOrUrl) {
    const url = idOrUrl.startsWith("http")
        ? idOrUrl
        : `${VIDMOLY}/dl/${idOrUrl.replace(/^\/+/, "")}`;

    const results = [];

    // 1. Static attempt.
    try {
        const html = await get(url, { headers: { Referer: VIDMOLY + "/" } });
        collectFromHtml(html, url, results);
    } catch (e) {
        // likely Cloudflare 403 — fall through
    }

    if (results.length) return results;

    // 2. Browser capture.
    if (isAvailable()) {
        try {
            const hit = await captureStream(url, {
                referer: VIDMOLY + "/",
                prefer: "hls",
                timeoutMs: 25000
            });
            if (hit) {
                results.push({
                    url: hit.url,
                    type: hit.type,
                    quality: "Auto",
                    referer: url
                });
            }
        } catch (e) {
            // graceful degradation
        }
    }

    return results;
}

// Pull any m3u8/mp4 and JWPlayer `sources` out of vidmoly player HTML.
function collectFromHtml(html, sourceUrl, results) {
    const seen = new Set();
    const add = (u, type, quality) => {
        if (!u || seen.has(u)) return;
        seen.add(u);
        results.push({
            url: u,
            type: type || (/\.m3u8$/i.test(u) ? "hls" : "mp4"),
            quality: quality || "Auto",
            referer: sourceUrl
        });
    };

    // JWPlayer-style: sources:[{file:"...",label:"..."}]
    const sourcesRe = /sources\s*:\s*\[([\s\S]*?)\]/g;
    let m;
    while ((m = sourcesRe.exec(html)) !== null) {
        const block = m[1];
        const fileRe = /\{\s*["']?file["']?\s*:\s*["']([^"']+)["'](?:[^}]*?["']?label["']?\s*:\s*["']([^"']+)["'])?/g;
        let fm;
        while ((fm = fileRe.exec(block)) !== null) {
            add(fm[1], null, fm[2]);
        }
    }

    // Bare m3u8/mp4 URLs.
    const urlRe = /https?:\/\/[^"'\s<>]+?\.(?:m3u8|mp4)(?:\?[^"'\s<>]*)?/gi;
    while ((m = urlRe.exec(html)) !== null) {
        add(m[0]);
    }
}

module.exports = { extractVidmoly };
