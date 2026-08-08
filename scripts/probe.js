// Standalone extractor probe. Run with:
//   node scripts/probe.js <episode-url>      e.g. https://turkish123.pro/yemin-episode-503/
//   node scripts/probe.js <slug> <absEpisode>  e.g. yemin 503

const { get } = require("../src/util/http");
const { BASE_URL } = require("../src/catalog");
const { parseEpisodeSources, extract } = require("../src/extractors");

async function main() {
    let url;
    if (process.argv[2] && process.argv[3]) {
        url = `${BASE_URL}/${process.argv[2]}-episode-${process.argv[3]}/`;
    } else if (process.argv[2]) {
        url = process.argv[2];
    } else {
        console.log("Usage: node scripts/probe.js <episode-url>");
        console.log("       node scripts/probe.js <slug> <absEpisode>");
        process.exit(1);
    }

    console.log(`Fetching episode page: ${url}`);
    const html = await get(url);
    const sources = parseEpisodeSources(html);

    if (!sources.length) {
        console.log("❌ No server sources found on the episode page.");
        console.log("   The download-section markup may have changed. Raw <a> links:");
        const m = html.match(/<a[^>]*href="https?:\/\/[^"]+"[^>]*>Server [0-9]/g);
        console.log(m ? m.join("\n") : "  (none matched 'Server N')");
        return;
    }

    console.log(`\nFound ${sources.length} source(s):`);
    sources.forEach((s, i) =>
        console.log(`  ${i + 1}. [${s.host}] ${s.url}`)
    );

    console.log("\nResolving streams...\n");
    for (const source of sources) {
        process.stdout.write(`  [${source.host}] `);
        try {
            const streams = await extract(source);
            if (!streams.length) {
                console.log("✗ no stream resolved");
            } else {
                console.log("✓");
                streams.forEach((st) => {
                    console.log(`     • ${st.quality || st.type} → ${st.url}`);
                    if (st.referer) console.log(`       referer: ${st.referer}`);
                });
            }
        } catch (e) {
            console.log(`✗ error: ${e.message}`);
        }
    }
}

main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
});
