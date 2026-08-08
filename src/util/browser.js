// Optional headless-browser stream capture for hosts whose stream URL is only
// produced by executing obfuscated player JS (voe.sx) or hidden behind a
// Cloudflare challenge (vidmoly).
//
// Uses puppeteer-extra + stealth when available (and USE_PUPPETEER=true).
// All extractors that depend on this MUST degrade gracefully if the browser
// is unavailable, so the addon still serves the reliable tokvoy source.

let puppeteer = null;
try {
    // optionalDependencies — may not be installed on minimal hosts.
    puppeteer = require("puppeteer-extra");
    const StealthPlugin = require("puppeteer-extra-plugin-stealth");
    puppeteer.use(StealthPlugin());
} catch (e) {
    puppeteer = null;
}

function isAvailable() {
    return puppeteer !== null && process.env.USE_PUPPETEER === "true";
}

/**
 * Launch a browser, navigate to `pageUrl`, and capture any HLS (.m3u8) or
 * progressive (.mp4) URL that the page requests. Returns the best candidate.
 *
 * @param {string} pageUrl
 * @param {object} opts { referer, prefer: 'hls'|'mp4', timeoutMs }
 * @returns {Promise<{url, type}|null>}
 */
async function captureStream(pageUrl, opts = {}) {
    if (!isAvailable()) return null;

    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--disable-gpu"
        ]
    });

    const timeoutMs = opts.timeoutMs || 25000;
    const prefer = opts.prefer || "hls";
    let candidate = null;

    try {
        const page = await browser.newPage();
        await page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );
        if (opts.referer) {
            await page.setExtraHTTPHeaders({ Referer: opts.referer });
        }

        // Capture media requests as they happen.
        page.on("request", (req) => {
            const u = req.url();
            if (!candidate && /\.(m3u8|mp4)(\?|$)/i.test(u)) {
                const type = /\.m3u8/i.test(u) ? "hls" : "mp4";
                // Prefer the requested type; otherwise take the first found.
                if (!candidate || type === prefer) {
                    candidate = { url: u, type };
                }
            }
        });

        await page.goto(pageUrl, { waitUntil: "networkidle2", timeout: timeoutMs })
            .catch(() => {});
        // Give the player JS a moment to fire its media request.
        await new Promise((r) => setTimeout(r, 4000));

        // As a fallback, read jwplayer config if present.
        if (!candidate) {
            try {
                candidate = await page.evaluate(() => {
                    if (typeof jwplayer === "function") {
                        const cfg = jwplayer().getPlaylistItem
                            ? jwplayer().getPlaylistItem()
                            : null;
                        if (cfg && cfg.file) {
                            return {
                                url: cfg.file,
                                type: /\.m3u8/i.test(cfg.file) ? "hls" : "mp4"
                            };
                        }
                        const lvl = jwplayer().getQualityLevels
                            ? jwplayer().getQualityLevels()
                            : null;
                    }
                    return null;
                });
            } catch (e) {}
        }
    } finally {
        await browser.close().catch(() => {});
    }

    return candidate;
}

module.exports = { captureStream, isAvailable };
