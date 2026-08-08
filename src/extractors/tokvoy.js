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

    // Step 1: GET the download page and pull the single-use hash out of the form.
    let pageHtml = await get(pageUrl, {
        headers: { Referer: TOKVOY + "/" }
    });

    // Step 2: POST the form. The response page embeds the direct .mp4 link.
    // If the server is enforcing its per-IP cooldown ("wait 6 seconds"), the
    // POST re-renders the form with a FRESH hash instead of the .mp4. We detect
    // that and retry once after a short wait — the second attempt then succeeds.
    for (let attempt = 0; attempt < 2; attempt++) {
        const $ = cheerio.load(pageHtml);
        const op = $('input[name="op"]').attr("value") || "download_orig";
        const id = $('input[name="id"]').attr("value") || filecode;
        const hash = $('input[name="hash"]').attr("value");
        if (!hash) return null;

        const postRes = await client.post(pageUrl, new URLSearchParams({
            op, id, mode, hash
        }).toString(), {
            headers: {
                ...BROWSER_HEADERS,
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": pageUrl,
                "X-Requested-With": "XMLHttpRequest",
                "Origin": TOKVOY
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
                // The CDN checks the tokvoy referer; the proxy route injects it.
                referer: TOKVOY + "/"
            };
        }

        // Cooldown page: it re-renders the form (with a new hash). Wait and retry.
        const waiting = /wait\s+\d+\s+second/i.test(body);
        if (waiting && attempt === 0) {
            await new Promise((r) => setTimeout(r, 6500));
            pageHtml = await get(pageUrl, { headers: { Referer: TOKVOY + "/" } });
            continue;
        }
        return null;
    }
    return null;
}

/**
 * Try multiple qualities for a filecode, returning the best available.
 * Falls through to the next quality if one fails (e.g. cooldown), so the user
 * always gets at least one playable source when the host is up.
 * @returns {Promise<Array<{url, quality, referer}>>}
 */
async function extractTokvoyAll(filecode) {
    const results = [];
    for (const mode of ["x", "h", "n"]) {
        try {
            const r = await extractTokvoy(filecode, mode);
            if (r) {
                results.push(r);
                break; // one good source is enough; stop to spare the cooldown
            }
        } catch (e) {
            // try next quality
        }
    }
    return results;
}

module.exports = { extractTokvoy, extractTokvoyAll, TOKVOY };
