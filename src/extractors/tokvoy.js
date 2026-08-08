const cheerio = require("cheerio");
const { get, client, BROWSER_HEADERS } = require("../util/http");

// Primary, reliable extractor. engifuosi.com is just a skin over tokvoy.com;
// the engifuosi download page lists the tokvoy quality links directly:
//   https://tokvoy.com/d/{filecode}_x  (FHD 1080p)
//   https://tokvoy.com/d/{filecode}_h  (HD 720p)
//   https://tokvoy.com/d/{filecode}_n  (Normal 480p)
//
// tokvoy is an xfilesharing-style host: each quality page holds a POST form
// with a single-use `hash`. POSTing it returns a page with the direct CDN
// .mp4 URL (6s cooldown between requests, fine for per-click streaming).

const TOKVOY = "https://tokvoy.com";
const QUALITY_MODE = { x: "FHD", h: "HD", n: "SD" };

/**
 * Extract a direct .mp4 stream from tokvoy for the given quality mode.
 * @param {string} filecode  e.g. "pgyytadyskos"
 * @param {string} mode      "x" | "h" | "n"
 * @returns {Promise<{url, quality, fileName}|null>}
 */
async function extractTokvoy(filecode, mode = "x") {
    const pageUrl = `${TOKVOY}/d/${filecode}_${mode}`;
    const headers = {
        ...BROWSER_HEADERS,
        Referer: pageUrl,
        Origin: TOKVOY,
        "X-Requested-With": "XMLHttpRequest"
    };

    // tokvoy enforces two per-IP limits that can make a POST fail transiently:
    //   - "wait N seconds" cooldown between downloads
    //   - "Security error1" lockout under rapid/bursty requests
    // Both clear after a short delay, so we retry with backoff. The GET always
    // succeeds; it's the POST that hits the limits. We re-GET on each retry to
    // fetch a fresh single-use hash (a consumed hash is rejected).
    for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
            // Backoff: wait long enough for the 6s cooldown / brief lockout.
            await new Promise((r) => setTimeout(r, 7000));
        }

        // Step 1: GET the download page, pull the single-use hash out of the form.
        const pageHtml = await get(pageUrl, { headers: { Referer: TOKVOY + "/" } });
        const $ = cheerio.load(pageHtml);
        const op = $('input[name="op"]').attr("value") || "download_orig";
        const id = $('input[name="id"]').attr("value") || filecode;
        const hash = $('input[name="hash"]').attr("value");
        if (!hash) return null; // version doesn't exist for this filecode

        // Step 2: POST the form. The response page embeds the direct CDN .mp4.
        const postRes = await client.post(pageUrl, new URLSearchParams({
            op, id, mode, hash
        }).toString(), {
            headers: {
                ...headers,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            responseType: "text",
            validateStatus: (s) => s < 500
        });

        const body = String(postRes.data);
        // The direct link carries signed query params (?t=...&s=...&e=...) that
        // are IP-bound and valid ~12 minutes. They MUST be captured, so the
        // regex includes any trailing ?query until a quote/whitespace.
        const directUrl = body.match(/https?:\/\/[^"'\s<>]+?\.mp4(?:\?[^"'\s<>]*)?/i);
        if (directUrl) {
            return {
                url: directUrl[0],
                quality: QUALITY_MODE[mode] || mode.toUpperCase(),
                fileName: `${filecode}_${mode}.mp4`,
                referer: TOKVOY + "/"
            };
        }

        // Transient rate-limit responses -> retry with backoff. Anything else
        // (e.g. "not available") means give up on this mode.
        const transient = /wait\s+\d+\s+second/i.test(body) ||
            /security error/i.test(body);
        if (!transient) return null;
    }
    return null;
}

// Discover which quality versions actually exist for a filecode.
// The engifuosi download skin lists only the available tokvoy quality links
// (e.g. /d/{filecode}_x, _h, _n), so we know exactly which to try — this avoids
// hitting tokvoy for versions that don't exist (which would otherwise burn
// through the per-IP cooldown before reaching a valid one).
const ENGUIFUOSI = "https://engifuosi.com";

async function availableModes(filecode) {
    try {
        const html = await get(`${ENGUIFUOSI}/d/${filecode}.html`, {
            headers: { Referer: ENGUIFUOSI + "/" }
        });
        const found = new Set();
        const re = /tokvoy\.com\/d\/[a-z0-9_-]+?_([xhn])(?:[/"'\s]|$)/gi;
        let m;
        while ((m = re.exec(html)) !== null) found.add(m[1]);
        if (found.size) {
            // Return best-first.
            return ["x", "h", "n"].filter((mode) => found.has(mode));
        }
    } catch (e) {
        // engifuosi unreachable — fall back to trying all.
    }
    return ["x", "h", "n"];
}

/**
 * Resolve the best available quality for a filecode. Asks engifuosi which
 * versions exist first, then extracts the best one.
 * @returns {Promise<Array<{url, quality, referer}>>}
 */
async function extractTokvoyAll(filecode) {
    const modes = await availableModes(filecode);
    for (const mode of modes) {
        try {
            const r = await extractTokvoy(filecode, mode);
            if (r) return [r];
        } catch (e) {
            // try next quality
        }
    }
    return [];
}

module.exports = { extractTokvoy, extractTokvoyAll, availableModes, TOKVOY };
