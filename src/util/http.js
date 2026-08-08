const axios = require("axios");

// Realistic Chrome headers used for every request to the source site and hosts.
// These mirror what a browser sends and keep the anti-bot heuristics calm.
const BROWSER_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Ch-Ua": '"Chromium";v="120", "Not?A_Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"'
};

const client = axios.create({
    timeout: 20000,
    validateStatus: (s) => s < 400,
    maxRedirects: 5
});

/**
 * GET a URL as text (default) or with a custom responseType.
 * @param {string} url
 * @param {object} opts  extra axios config (headers, responseType, etc.)
 * @returns {Promise<string|object>}  response.data
 */
async function get(url, opts = {}) {
    const res = await client.get(url, {
        headers: { ...BROWSER_HEADERS, ...(opts.headers || {}) },
        responseType: opts.responseType || "text",
        ...opts
    });
    return res.data;
}

module.exports = { get, client, BROWSER_HEADERS };
