
const API_BASE = ''; // Relative path

export const api = {
    getLists: async () => {
        const res = await fetch(`${API_BASE}/lists/`);
        if (!res.ok) throw new Error('Failed to fetch lists');
        return res.json();
    },

    createList: async (name, color) => {
        const res = await fetch(`${API_BASE}/lists/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, color }),
        });
        if (!res.ok) throw new Error('Failed to create list');
        return res.json();
    },

    updateList: async (id, name, color) => {
        const res = await fetch(`${API_BASE}/lists/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, color }),
        });
        if (!res.ok) throw new Error('Failed to update list');
        return res.json();
    },

    deleteList: async (id) => {
        const res = await fetch(`${API_BASE}/lists/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete list');
        return res.json();
    },

    getVessels: async (listId) => {
        const url = listId ? `${API_BASE}/vessels/?list_id=${listId}` : `${API_BASE}/vessels/`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch vessels');
        return res.json();
    },

    getConflicts: async () => {
        const res = await fetch(`${API_BASE}/vessels/conflicts`);
        if (!res.ok) throw new Error('Failed to fetch conflicts');
        return res.json();
    },

    createVessel: async (mmsi, imo, name, callsign, flag, lastposition, note, listId) => {
        const res = await fetch(`${API_BASE}/vessels/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mmsi, imo, name, callsign, flag, lastposition, note, list_id: listId }),
        });
        if (!res.ok) throw new Error('Failed to add vessel');
        return res.json();
    },

    createVesselBulk: async (mmsi, imo, name, callsign, flag, lastposition, note, listIds) => {
        const res = await fetch(`${API_BASE}/vessels/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mmsi,
                imo,
                name,
                callsign,
                flag,
                lastposition,
                note,
                list_ids: listIds
            }),
        });
        if (!res.ok) throw new Error('Failed to add vessel to lists');
        return res.json();
    },

    updateVessel: async (id, mmsi, imo, name, callsign, flag, lastposition, note) => {
        const body = {};
        if (mmsi !== undefined) body.mmsi = mmsi;
        if (imo !== undefined) body.imo = imo;
        if (name !== undefined) body.name = name;
        if (callsign !== undefined) body.callsign = callsign;
        if (flag !== undefined) body.flag = flag;
        if (lastposition !== undefined) body.lastposition = lastposition;
        if (note !== undefined) body.note = note;

        const res = await fetch(`${API_BASE}/vessels/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Failed to update vessel');
        return res.json();
    },

    searchVessels: async (query) => {
        const res = await fetch(`${API_BASE}/vessels/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error('Failed to search vessels');
        return res.json();
    },

    deleteVessel: async (id) => {
        const res = await fetch(`${API_BASE}/vessels/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete vessel');
        return res.json();
    },

    getStats: async () => {
        const res = await fetch(`${API_BASE}/analytics/stats`);
        if (!res.ok) throw new Error('Failed to fetch stats');
        return res.json();
    },

    exportListCSV: async (listId) => {
        const res = await fetch(`${API_BASE}/analytics/export/list/${listId}`);
        if (!res.ok) throw new Error('Failed to export CSV');
        const blob = await res.blob();
        return blob;
    },

    getAvailableFlags: async () => {
        const res = await fetch(`${API_BASE}/analytics/filters/flags`);
        if (!res.ok) throw new Error('Failed to fetch flags');
        return res.json();
    },

    advancedSearch: async (filters) => {
        const params = new URLSearchParams();
        Object.keys(filters).forEach(key => {
            if (filters[key] !== null && filters[key] !== undefined && filters[key] !== '') {
                params.append(key, filters[key]);
            }
        });
        const res = await fetch(`${API_BASE}/analytics/vessels/advanced-search?${params}`);
        if (!res.ok) throw new Error('Failed to search vessels');
        return res.json();
    },

    getAggregatedVessels: async () => {
        const res = await fetch(`${API_BASE}/analytics/vessels/aggregated`);
        if (!res.ok) throw new Error('Failed to fetch aggregated vessels');
        return res.json();
    },

    exportAggregatedCSV: async () => {
        const res = await fetch(`${API_BASE}/analytics/export/aggregated`);
        if (!res.ok) throw new Error('Failed to export aggregated CSV');
        const blob = await res.blob();
        return blob;
    },

    getDocuments: async (mmsi, page = 1, size = 20) => {
        const res = await fetch(`${API_BASE}/documents/?mmsi=${encodeURIComponent(mmsi)}&page=${page}&size=${size}`);
        if (!res.ok) throw new Error('Failed to fetch documents');
        return res.json();
    },

    getDocument: async (id) => {
        const res = await fetch(`${API_BASE}/documents/${id}`);
        if (!res.ok) throw new Error('Failed to fetch document');
        return res.json();
    },

    createDocument: async (mmsi, jsonData) => {
        const res = await fetch(`${API_BASE}/documents/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mmsi, json_data: jsonData }),
        });
        if (!res.ok) throw new Error('Failed to create document');
        return res.json();
    },

    updateDocument: async (id, jsonData) => {
        const res = await fetch(`${API_BASE}/documents/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ json_data: jsonData }),
        });
        if (!res.ok) throw new Error('Failed to update document');
        return res.json();
    },

    deleteDocument: async (id) => {
        const res = await fetch(`${API_BASE}/documents/${id}`, {
            method: 'DELETE',
        });
        if (!res.ok) throw new Error('Failed to delete document');
        return res.json();
    },

    getDocumentCount: async (mmsi) => {
        const res = await fetch(`${API_BASE}/documents/count/${encodeURIComponent(mmsi)}`);
        if (!res.ok) throw new Error('Failed to get document count');
        return res.json();
    },

    exportDocument: async (id, format = 'json') => {
        const res = await fetch(`${API_BASE}/documents/export/${id}?format=${format}`);
        if (!res.ok) throw new Error('Failed to export document');
        const blob = await res.blob();
        return blob;
    },
};
