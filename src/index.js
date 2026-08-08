const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const manifest = require("./manifest");
const { getSeries, getMeta } = require("./catalog");
const { getStream } = require("./stream");

const app = express();
app.use(cors());

const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    if (type === "series" && id === "turkish123_catalog") {
        const metas = await getSeries(extra || {});
        return { metas };
    }
    return { metas: [] };
});

builder.defineMetaHandler(async ({ type, id }) => {
    return await getMeta(type, id);
});

builder.defineStreamHandler(async ({ type, id }) => {
    return await getStream(type, id);
});

// Proxy route.
//
// Two jobs:
//   1. For HLS playlists (.m3u8): buffer the response, rewrite every segment
//      line back through this proxy, force the HLS content-type. This is what
//      lets a hotlink-protected CDN play inside Stremio's web player.
//   2. For media segments / direct .mp4: pipe straight through (low memory).
//
// Query params:
//   url     - the absolute URL to fetch (required)
//   referer - the Referer header to send to the CDN (optional)
//   cookie  - cookies to forward (optional)
app.get("/proxy", async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send("Missing url param");

    const referer = req.query.referer || "";
    const cookie = req.query.cookie || "";

    try {
        const response = await axios.get(targetUrl, {
            headers: {
                "User-Agent": UA,
                Referer: referer || undefined,
                Cookie: cookie || undefined,
                Accept: "*/*",
                "Accept-Encoding": "identity"
            },
            responseType: "stream",
            validateStatus: (s) => s < 400,
            maxRedirects: 5
        });

        const contentType = response.headers["content-type"] || "";
        const isPlaylist =
            targetUrl.includes(".m3u8") ||
            targetUrl.includes(".txt") ||
            contentType.includes("mpegurl");

        if (isPlaylist) {
            const chunks = [];
            response.data.on("data", (c) => chunks.push(c));
            response.data.on("end", () => {
                const content = Buffer.concat(chunks).toString("utf-8");
                res.setHeader("Content-Type", "application/vnd.apple.mpegurl");

                const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf("/") + 1);
                const hostUrl = new URL(targetUrl).origin;

                const rewritten = content.replace(/^(?!#)(.+)$/gm, (line) => {
                    line = line.trim();
                    if (!line) return "";
                    let absolute = line;
                    if (line.startsWith("http")) absolute = line;
                    else if (line.startsWith("/")) absolute = hostUrl + line;
                    else absolute = baseUrl + line;

                    const params = new URLSearchParams();
                    params.set("url", absolute);
                    if (referer) params.set("referer", referer);
                    if (cookie) params.set("cookie", cookie);
                    return `/proxy?${params.toString()}`;
                });

                res.send(rewritten);
            });
            response.data.on("error", () => {
                if (!res.headersSent) res.status(500).send("Stream error");
            });
        } else {
            // Media segment or direct mp4: pipe through.
            res.setHeader("Content-Type", contentType || "application/octet-stream");
            response.data.pipe(res);
            response.data.on("error", () => {});
        }
    } catch (e) {
        if (e.response) {
            if (!res.headersSent) res.sendStatus(e.response.status);
        } else {
            if (!res.headersSent) res.status(500).send(e.message);
        }
    }
});

const addonInterface = builder.getInterface();
const addonRouter = getRouter(addonInterface);
app.use("/", addonRouter);

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`Turkish123 addon running on http://localhost:${PORT}`);
    console.log(`Manifest: http://localhost:${PORT}/manifest.json`);
});
