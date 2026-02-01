import { api } from './api.js';

export const analytics = {
    async loadStats() {
        try {
            const stats = await api.getStats();

            document.getElementById('stat-lists').textContent = stats.overview.total_lists;
            document.getElementById('stat-vessels').textContent = stats.overview.total_vessels;
            document.getElementById('stat-flags').textContent = stats.overview.unique_flags;
            document.getElementById('stat-imo').textContent = stats.overview.with_imo;
            document.getElementById('stat-position').textContent = stats.overview.with_position;

            const flagSelect = document.getElementById('filter-flag');
            const listSelect = document.getElementById('filter-list');

            stats.flags.forEach(flagData => {
                const option = document.createElement('option');
                option.value = flagData.flag;
                option.textContent = `${flagData.flag} (${flagData.count})`;
                flagSelect.appendChild(option);
            });

            stats.lists.forEach(list => {
                const option = document.createElement('option');
                option.value = list.name;
                option.textContent = `${list.name} (${list.vessel_count})`;
                option.dataset.listId = list.vessel_count; // Store for later use
                listSelect.appendChild(option);
            });

        } catch (error) {
            console.error('Failed to load stats:', error);
        }
    },

    bindAdvancedSearch() {
        const searchBtn = document.getElementById('advanced-search-btn');
        const clearBtn = document.getElementById('clear-filters-btn');

        searchBtn.addEventListener('click', async () => {
            const filters = {
                mmsi: document.getElementById('filter-mmsi').value,
                imo: document.getElementById('filter-imo').value,
                name: document.getElementById('filter-name').value,
                flag: document.getElementById('filter-flag').value,
                has_imo: document.getElementById('filter-has-imo').value,
            };

            try {
                const results = await api.advancedSearch(filters);
                this.renderSearchResults(results);
                document.getElementById('list-grid').style.display = 'none';
            } catch (error) {
                alert('Search failed: ' + error.message);
            }
        });

        clearBtn.addEventListener('click', () => {
            document.getElementById('filter-mmsi').value = '';
            document.getElementById('filter-imo').value = '';
            document.getElementById('filter-name').value = '';
            document.getElementById('filter-flag').value = '';
            document.getElementById('filter-list').value = '';
            document.getElementById('filter-has-imo').value = '';
            document.getElementById('search-results').innerHTML = '';
            document.getElementById('list-grid').style.display = 'grid';
        });
    },

    renderSearchResults(results) {
        const container = document.getElementById('search-results');

        if (results.length === 0) {
            container.innerHTML = '<p style="opacity: 0.7; text-align: center; padding: 2rem;">No vessels found matching your criteria.</p>';
            return;
        }

        container.innerHTML = `
            <div style="background: var(--card-bg); border: var(--card-border); border-radius: 0.75rem; padding: 1rem; margin-bottom: 1rem;">
                <strong>${results.length} vessel(s) found</strong>
            </div>
        `;

        const resultsDiv = document.createElement('div');
        resultsDiv.className = 'search-results';

        results.forEach(vessel => {
            const item = document.createElement('div');
            item.className = 'search-result-item';
            item.style.borderLeftColor = vessel.list_color;
            item.innerHTML = `
                <div class="search-result-info">
                    <div><strong>MMSI:</strong> ${vessel.mmsi} ${vessel.imo ? `| <strong>IMO:</strong> ${vessel.imo}` : ''}</div>
                    ${vessel.name ? `<div><strong>Name:</strong> ${vessel.name}</div>` : ''}
                    ${vessel.flag ? `<div><strong>Flag:</strong> ${vessel.flag}</div>` : ''}
                    <div style="margin-top: 0.5rem;">
                        <span class="search-result-badge" style="background-color: ${vessel.list_color}33;">
                            <span class="list-badge" style="background-color: ${vessel.list_color}"></span>
                            ${vessel.list_name}
                        </span>
                    </div>
                </div>
            `;
            resultsDiv.appendChild(item);
        });

        container.appendChild(resultsDiv);
    },

    async exportListCSV(listId, listName) {
        try {
            const blob = await api.exportListCSV(listId);
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${listName.replace(/\s+/g, '_')}.csv`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            alert('Export failed: ' + error.message);
        }
    },

    bindAllVessels() {
        const exportAggregatedBtn = document.getElementById('page-export-aggregated-btn');

        exportAggregatedBtn.addEventListener('click', async () => {
            try {
                const blob = await api.exportAggregatedCSV();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'aggregated_vessels.csv';
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            } catch (error) {
                alert('Export failed: ' + error.message);
            }
        });
    },

    async loadAggregatedVessels() {
        try {
            const data = await api.getAggregatedVessels();

            document.getElementById('page-total-unique-vessels').textContent = data.total_unique_vessels;

            const container = document.getElementById('page-aggregated-vessels-content');

            if (data.vessels.length === 0) {
                container.innerHTML = '<p style="text-align: center; opacity: 0.7; padding: 3rem;">No vessels found</p>';
                return;
            }

            container.innerHTML = data.vessels.map(vessel => `
                <div class="aggregated-vessel-item">
                    <div class="vessel-info-row">
                        <div>
                            <strong style="font-size: 1.1rem;">${vessel.mmsi || 'N/A'}</strong>
                            ${vessel.imo ? `<span style="opacity: 0.7; margin-left: 0.5rem;">IMO: ${vessel.imo}</span>` : ''}
                        </div>
                        <div style="display: flex; gap: 1rem; flex-wrap: wrap; align-items: center;">
                            ${vessel.name ? `<span><strong>Name:</strong> ${vessel.name}</span>` : ''}
                            ${vessel.flag ? `<span><strong>Flag:</strong> ${vessel.flag}</span>` : ''}
                        </div>
                        <div class="list-count-badge">
                            ${vessel.list_count} ${vessel.list_count === 1 ? 'List' : 'Lists'}
                        </div>
                    </div>
                    <div class="vessel-lists-badges">
                        ${vessel.lists.map(list => `
                            <span class="search-result-badge" style="background-color: ${list.list_color}33;">
                                <span class="list-badge" style="background-color: ${list.list_color}"></span>
                                ${list.list_name}
                            </span>
                        `).join('')}
                    </div>
                </div>
            `).join('');

        } catch (error) {
            console.error('Failed to load aggregated vessels:', error);
            alert('Failed to load vessels: ' + error.message);
        }
    },

    init() {
        this.loadStats();
        this.bindAdvancedSearch();
        this.bindAllVessels();
    }
};
