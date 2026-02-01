export async function parseCSV(file) {
    const text = await file.text();
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return [];

    const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
    const mmsiIndex = headers.indexOf('mmsi');
    const imoIndex = headers.indexOf('imo');

    if (mmsiIndex === -1) {
        throw new Error('CSV must contain an "mmsi" column');
    }

    const vessels = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = line.split(',').map(c => c.trim());
        const mmsi = cols[mmsiIndex];
        const imo = imoIndex !== -1 ? cols[imoIndex] : null;

        if (mmsi) {
            vessels.push({ mmsi, imo });
        }
    }
    return vessels;
}
