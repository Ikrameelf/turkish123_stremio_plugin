const manifest = {
    id: "org.turkish123.stremio",
    version: "1.0.0",
    name: "Turkish123 — Turkish Series (English Subtitles)",
    description: "Watch all Turkish series with English subtitles from Turkish123. New shows appear automatically.",
    resources: ["catalog", "meta", "stream"],
    types: ["series"],
    catalogs: [
        {
            type: "series",
            id: "turkish123_catalog",
            name: "Turkish123 Series",
            extra: [
                { name: "search", isRequired: false },
                { name: "skip", isRequired: false }
            ]
        }
    ],
    idPrefixes: ["turkish123:"]
};

module.exports = manifest;
