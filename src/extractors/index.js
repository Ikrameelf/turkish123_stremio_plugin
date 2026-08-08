const { extractTokvoy, extractTokvoyAll } = require("./tokvoy");
const { extractVoe } = require("./voe");
const { extractVidmoly } = require("./vidmoly");

// Parse the download-section <a> links from a turkish123 episode page and
// return a structured list of { host, filecode, url } entries, in server order.
//
// The episode page exposes plain links like:
//   https://engifuosi.com/d/<filecode>.html   -> tokvoy (primary)
//   https://vidmoly.me/dl/<filecode>          -> vidmoly
//   https://voe.sx/<filecode>/download        -> voe
const cheerio = require("cheerio");

function parseEpisodeSources(episodeHtml) {
    const $ = cheerio.load(episodeHtml);
    const sources = [];
    const seen = new Set();

    // The download links live in <div class="download_navi"> as <a href="..." >Server N</a>.
    $(".download_navi a, .les-content a").each((_, el) => {
        const href = $(el).attr("href") || "";
        const label = $(el).text().trim();
        if (!href || seen.has(href)) return;

        // engifuosi -> tokvoy backend
        let m = href.match(/engifuosi\.com\/(?:d|e|v)\/([a-z0-9_-]+)/i);
        if (m) {
            seen.add(href);
            sources.push({ host: "engifuosi", filecode: m[1], url: href, label });
            return;
        }
        // direct tokvoy link
        m = href.match(/tokvoy\.com\/(?:d|e|v)\/([a-z0-9_-]+)(?:_([xhn]))?/i);
        if (m) {
            seen.add(href);
            sources.push({ host: "tokvoy", filecode: m[1], url: href, label });
            return;
        }
        // vidmoly
        m = href.match(/vidmoly\.[a-z]+\/(?:dl|d|e|v)\/([a-z0-9_-]+)/i);
        if (m) {
            seen.add(href);
            sources.push({ host: "vidmoly", filecode: m[1], url: href, label });
            return;
        }
        // voe.sx (strip trailing /download)
        m = href.match(/voe\.sx\/(?:e\/)?([a-z0-9_-]+)/i);
        if (m) {
            seen.add(href);
            sources.push({ host: "voe", filecode: m[1], url: href, label });
            return;
        }
    });

    return sources;
}

// Run the right extractor for a parsed source, returning normalized
// stream objects: { url, type, quality, referer }.
async function extract(source) {
    switch (source.host) {
        case "engifuosi":
        case "tokvoy": {
            const r = await extractTokvoyAll(source.filecode);
            return r;
        }
        case "vidmoly": {
            const r = await extractVidmoly(source.url);
            return r;
        }
        case "voe": {
            const r = await extractVoe(source.url);
            return r;
        }
        default:
            return [];
    }
}

module.exports = { parseEpisodeSources, extract };
