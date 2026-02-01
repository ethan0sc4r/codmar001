import { api } from './api.js';
import { parseCSV } from './csv_parser.js';
import { analytics } from './analytics.js';

export const ui = {
    state: {
        lists: [],
        currentList: null,
        conflictedLists: new Set() // Track list IDs with conflicts
    },

    elements: {
        grid: document.getElementById('list-grid'),
        createModal: document.getElementById('create-modal'),
        listModal: document.getElementById('list-modal'),
        createBtn: document.getElementById('create-btn'),
        closeCreateBtn: document.getElementById('close-create'),
        closeListBtn: document.getElementById('close-list'),
        listForm: document.getElementById('list-form'),
        listDetails: document.getElementById('list-details'),
        addVesselForm: document.getElementById('add-vessel-form'),
        csvInput: document.getElementById('csv-input'),
        uploadCsvBtn: document.getElementById('upload-csv-btn'),
        colorPalette: document.getElementById('color-palette'),
        colorInput: document.getElementById('list-color'),
        searchResults: document.getElementById('search-results'),
        quickAddBtn: document.getElementById('quick-add-vessel-btn'),
        quickAddModal: document.getElementById('quick-add-modal'),
        closeQuickAdd: document.getElementById('close-quick-add'),
        quickAddForm: document.getElementById('quick-add-form'),
        quickListsSelection: document.getElementById('quick-lists-selection')
    },

    init() {
        this.renderPalette();
        this.bindEvents();
        this.bindConflictEvents();
        this.bindQuickAddEvents();
        this.loadLists();
        this.loadConflicts();
    },

    renderPalette() {
        const colors = [
            '#ef4444', '#f97316', '#f59e0b', '#84cc16',
            '#10b981', '#06b6d4', '#3b82f6', '#6366f1',
            '#8b5cf6', '#d946ef', '#f43f5e', '#64748b'
        ];
        this.elements.colorPalette.innerHTML = '';
        colors.forEach(color => {
            const div = document.createElement('div');
            div.className = 'color-option';
            div.style.backgroundColor = color;
            div.onclick = () => {
                document.querySelectorAll('.color-option').forEach(el => el.classList.remove('selected'));
                div.classList.add('selected');
                this.elements.colorInput.value = color;
            };
            this.elements.colorPalette.appendChild(div);
        });
    },

    bindEvents() {
        this.elements.createBtn.addEventListener('click', () => this.openCreateModal());
        this.elements.closeCreateBtn.addEventListener('click', () => this.closeCreateModal());
        this.elements.closeListBtn.addEventListener('click', () => this.closeListModal());

        this.elements.colorInput.addEventListener('input', (e) => {
            document.querySelectorAll('.color-option').forEach(el => el.classList.remove('selected'));
        });

        this.elements.listForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('list-name').value;
            const color = this.elements.colorInput.value;
            try {
                await api.createList(name, color);
                this.closeCreateModal();
                this.loadLists();
                analytics.loadStats();
            } catch (err) {
                alert(err.message);
            }
        });

        this.elements.addVesselForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!this.state.currentList) return;
            const mmsi = document.getElementById('vessel-mmsi').value;
            const imo = document.getElementById('vessel-imo').value;
            const name = document.getElementById('vessel-name').value;
            const callsign = document.getElementById('vessel-callsign')?.value || '';
            const flag = document.getElementById('vessel-flag').value;
            const lastposition = document.getElementById('vessel-lastposition').value;
            const note = document.getElementById('vessel-note').value;
            try {
                await api.createVessel(mmsi, imo, name, callsign, flag, lastposition, note, this.state.currentList.id);

                document.getElementById('vessel-mmsi').value = '';
                document.getElementById('vessel-imo').value = '';
                document.getElementById('vessel-name').value = '';
                if (document.getElementById('vessel-callsign')) document.getElementById('vessel-callsign').value = '';
                document.getElementById('vessel-flag').value = '';
                document.getElementById('vessel-lastposition').value = '';
                document.getElementById('vessel-note').value = '';

                const successMsg = document.getElementById('vessel-added-message');
                if (successMsg) {
                    successMsg.style.display = 'block';
                    setTimeout(() => {
                        successMsg.style.display = 'none';
                    }, 2000);
                }

                document.getElementById('vessel-mmsi').focus();

                this.loadListDetails(this.state.currentList.id);
                analytics.loadStats();
            } catch (err) {
                alert(err.message);
            }
        });

        this.elements.uploadCsvBtn.addEventListener('click', async () => {
            const file = this.elements.csvInput.files[0];
            if (!file) return alert('Please select a file');
            if (!this.state.currentList) return;

            try {
                const vessels = await parseCSV(file);
                if (confirm(`Import ${vessels.length} vessels to ${this.state.currentList.name}?`)) {
                    for (const v of vessels) {
                        await api.createVessel(v.mmsi, v.imo, v.name, v.callsign, v.flag, v.lastposition, v.note, this.state.currentList.id);
                    }
                    this.loadListDetails(this.state.currentList.id);
                    this.elements.csvInput.value = '';
                    analytics.loadStats();
                }
            } catch (err) {
                alert('Error parsing CSV: ' + err.message);
            }
        });
    },

    bindSearchEvents() {
        const performSearch = async () => {
            const query = this.elements.searchInput.value.trim();
            if (!query) return;

            try {
                const results = await api.searchVessels(query);
                this.renderSearchResults(results);
                this.elements.clearSearchBtn.style.display = 'inline-flex';
                this.elements.grid.style.display = 'none';
            } catch (err) {
                this.elements.searchResults.innerHTML = `<p style="color: var(--accent-color);">Error: ${err.message}</p>`;
            }
        };

        this.elements.searchBtn.addEventListener('click', performSearch);
        this.elements.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') performSearch();
        });

        this.elements.clearSearchBtn.addEventListener('click', () => {
            this.elements.searchInput.value = '';
            this.elements.searchResults.innerHTML = '';
            this.elements.clearSearchBtn.style.display = 'none';
            this.elements.grid.style.display = 'grid';
        });
    },

    renderSearchResults(results) {
        if (results.length === 0) {
            this.elements.searchResults.innerHTML = '<p style="opacity: 0.7;">No vessels found.</p>';
            return;
        }

        this.elements.searchResults.innerHTML = '';
        const container = document.createElement('div');
        container.className = 'search-results';

        results.forEach(vessel => {
            const item = document.createElement('div');
            item.className = 'search-result-item';
            this.renderSearchResultItem(item, vessel);
            container.appendChild(item);
        });

        this.elements.searchResults.appendChild(container);
    },

    renderSearchResultItem(item, vessel) {
        item.style.borderLeftColor = vessel.list_color;
        item.innerHTML = `
            <div class="search-result-info">
                <div><strong>MMSI:</strong> ${vessel.mmsi} ${vessel.imo ? `| <strong>IMO:</strong> ${vessel.imo}` : ''}</div>
                <div style="margin-top: 0.5rem;">
                    <span class="search-result-badge" style="background-color: ${vessel.list_color}33;">
                        <span class="list-badge" style="background-color: ${vessel.list_color}"></span>
                        ${vessel.list_name}
                    </span>
                </div>
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: center;">
                <button class="action-btn edit-search-btn" title="Edit">✎</button>
                <button class="action-btn delete-search-btn" title="Delete">×</button>
                <button class="btn btn-secondary view-list-btn" data-list-id="${vessel.list_id}">View List</button>
            </div>
        `;

        item.querySelector('.edit-search-btn').addEventListener('click', () => {
            this.enableSearchResultEdit(item, vessel);
        });

        item.querySelector('.delete-search-btn').addEventListener('click', async () => {
            if (confirm('Remove this vessel?')) {
                try {
                    await api.deleteVessel(vessel.id);
                    item.remove();
                    analytics.loadStats();
                    if (this.elements.searchResults.querySelector('.search-results').children.length === 0) {
                        this.elements.searchResults.innerHTML = '<p style="opacity: 0.7;">No vessels found.</p>';
                    }
                } catch (err) {
                    alert(err.message);
                }
            }
        });

        item.querySelector('.view-list-btn').addEventListener('click', async () => {
            const list = this.state.lists.find(l => l.id === vessel.list_id);
            if (list) {
                this.state.currentList = list;
                this.openListModal(list);
            }
        });
    },

    enableSearchResultEdit(item, vessel) {
        item.innerHTML = `
            <div style="flex: 1; display: flex; gap: 0.5rem; align-items: center;">
                <div style="flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                    <input class="vessel-edit-input" type="text" value="${vessel.mmsi}" placeholder="MMSI" required>
                    <input class="vessel-edit-input" type="text" value="${vessel.imo || ''}" placeholder="IMO">
                </div>
                <button class="action-btn" style="color: #4ade80;" title="Save">✓</button>
                <button class="action-btn" style="color: #ef4444;" title="Cancel">✕</button>
            </div>
        `;

        const mmsiInput = item.querySelector('input[placeholder="MMSI"]');
        const imoInput = item.querySelector('input[placeholder="IMO"]');
        const saveBtn = item.querySelector('.action-btn[title="Save"]');
        const cancelBtn = item.querySelector('.action-btn[title="Cancel"]');

        const save = async () => {
            try {
                const updated = await api.updateVessel(vessel.id, mmsiInput.value, imoInput.value);
                vessel.mmsi = updated.mmsi;
                vessel.imo = updated.imo;
                this.renderSearchResultItem(item, vessel);
            } catch (err) {
                alert(err.message);
            }
        };

        saveBtn.addEventListener('click', save);
        mmsiInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
        imoInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
        cancelBtn.addEventListener('click', () => this.renderSearchResultItem(item, vessel));
    },

    bindConflictEvents() {
    },

    bindQuickAddEvents() {
        this.elements.quickAddBtn.addEventListener('click', () => {
            this.openQuickAddModal();
        });
        this.elements.closeQuickAdd.addEventListener('click', () => {
            this.closeQuickAddModal();
        });

        document.getElementById('select-all-lists').addEventListener('click', () => {
            document.querySelectorAll('.quick-list-checkbox').forEach(cb => cb.checked = true);
        });

        document.getElementById('deselect-all-lists').addEventListener('click', () => {
            document.querySelectorAll('.quick-list-checkbox').forEach(cb => cb.checked = false);
        });

        this.elements.quickAddForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const mmsi = document.getElementById('quick-mmsi').value;
            const imo = document.getElementById('quick-imo').value;
            const name = document.getElementById('quick-name').value;
            const callsign = document.getElementById('quick-callsign')?.value || '';
            const flag = document.getElementById('quick-flag').value;
            const lastposition = document.getElementById('quick-lastposition').value;
            const note = document.getElementById('quick-note').value;
            const keepOpen = document.getElementById('keep-modal-open').checked;

            const selectedLists = [];
            document.querySelectorAll('.quick-list-checkbox:checked').forEach(cb => {
                selectedLists.push(parseInt(cb.value));
            });

            if (selectedLists.length === 0) {
                alert('Please select at least one list');
                return;
            }

            try {
                const result = await api.createVesselBulk(mmsi, imo, name, callsign, flag, lastposition, note, selectedLists);
                alert(`✓ Vessel added to ${result.created} list(s)`);

                if (keepOpen) {
                    document.getElementById('quick-mmsi').value = '';
                    document.getElementById('quick-imo').value = '';
                    document.getElementById('quick-name').value = '';
                    if (document.getElementById('quick-callsign')) document.getElementById('quick-callsign').value = '';
                    document.getElementById('quick-flag').value = '';
                    document.getElementById('quick-lastposition').value = '';
                    document.getElementById('quick-note').value = '';
                    document.getElementById('quick-mmsi').focus();
                } else {
                    this.closeQuickAddModal();
                }

                this.loadLists(); // Refresh to update counts
                this.loadConflicts(); // Check for new conflicts
                analytics.loadStats(); // Refresh dashboard stats
            } catch (err) {
                alert(err.message);
            }
        });
    },

    openQuickAddModal() {
        this.elements.quickListsSelection.innerHTML = '';
        this.state.lists.forEach(list => {
            const label = document.createElement('label');
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.gap = '0.5rem';
            label.style.padding = '0.5rem';
            label.style.cursor = 'pointer';
            label.style.borderRadius = '0.25rem';
            label.style.transition = 'background 0.2s';
            label.onmouseover = () => label.style.background = 'rgba(255,255,255,0.05)';
            label.onmouseout = () => label.style.background = 'transparent';

            label.innerHTML = `
                <input type="checkbox" class="quick-list-checkbox" value="${list.id}" style="width: auto; cursor: pointer;" />
                <span class="list-badge" style="background-color: ${list.color};"></span>
                <span>${list.name}</span>
            `;
            this.elements.quickListsSelection.appendChild(label);
        });

        this.elements.quickAddModal.classList.add('open');
    },

    closeQuickAddModal() {
        this.elements.quickAddModal.classList.remove('open');
        this.elements.quickAddForm.reset();
    },

    async loadConflicts() {
        try {
            const data = await api.getConflicts();

            this.state.conflictedLists.clear();
            if (data.conflicts.mmsi_duplicates) {
                data.conflicts.mmsi_duplicates.forEach(c => {
                    c.vessels.forEach(v => this.state.conflictedLists.add(v.list_id));
                });
            }
            if (data.conflicts.imo_duplicates) {
                data.conflicts.imo_duplicates.forEach(c => {
                    c.vessels.forEach(v => this.state.conflictedLists.add(v.list_id));
                });
            }
            if (data.conflicts.mmsi_imo_inconsistencies) {
                data.conflicts.mmsi_imo_inconsistencies.forEach(c => {
                    c.vessels.forEach(v => this.state.conflictedLists.add(v.list_id));
                });
            }

            const navBadge = document.getElementById('conflicts-badge-nav');
            const oldBadge = document.getElementById('conflicts-badge');

            if (data.total_conflicts > 0) {
                navBadge.textContent = data.total_conflicts;
                navBadge.style.display = 'inline-block';
                if (oldBadge) {
                    oldBadge.textContent = data.total_conflicts;
                    oldBadge.parentElement.style.display = 'flex';
                }

                document.getElementById('page-conflicts-overview').style.display = 'block';
                this.renderConflictsStats(data);
            } else {
                navBadge.style.display = 'none';
                if (oldBadge) {
                    oldBadge.parentElement.style.display = 'none';
                }
                document.getElementById('page-conflicts-overview').style.display = 'none';
            }

            this.renderConflicts(data);

            if (this.state.lists.length > 0) {
                this.render();
            }
        } catch (err) {
            console.error('Error loading conflicts:', err);
        }
    },

    renderConflictsStats(data) {
        const stats = document.getElementById('page-conflicts-stats');
        stats.innerHTML = `
            <div class="conflict-stat-card">
                <div class="conflict-stat-number">${data.total_conflicts}</div>
                <div class="conflict-stat-label">Total Conflicts</div>
            </div>
            <div class="conflict-stat-card">
                <div class="conflict-stat-number">${data.conflicts.mmsi_duplicates.length}</div>
                <div class="conflict-stat-label">MMSI Duplicates</div>
            </div>
            <div class="conflict-stat-card">
                <div class="conflict-stat-number">${data.conflicts.imo_duplicates.length}</div>
                <div class="conflict-stat-label">IMO Duplicates</div>
            </div>
            <div class="conflict-stat-card">
                <div class="conflict-stat-number">${data.conflicts.mmsi_imo_inconsistencies.length}</div>
                <div class="conflict-stat-label">Inconsistencies</div>
            </div>
            <div class="conflict-stat-card">
                <div class="conflict-stat-number">${this.state.conflictedLists.size}</div>
                <div class="conflict-stat-label">Affected Lists</div>
            </div>
        `;
    },

    renderConflicts(data) {
        const content = document.getElementById('page-conflicts-content');

        if (data.total_conflicts === 0) {
            content.innerHTML = `
                <div class="no-conflicts">
                    <div class="no-conflicts-icon">✅</div>
                    <h3>No Conflicts Detected</h3>
                    <p style="opacity: 0.7; margin-top: 0.5rem;">All vessel data is consistent across lists.</p>
                </div>
            `;
            return;
        }

        content.innerHTML = '';

        if (data.conflicts.mmsi_duplicates.length > 0) {
            const section = document.createElement('div');
            section.className = 'conflict-section';
            section.innerHTML = `
                <div class="conflict-section-header">
                    <span class="icon">🔄</span>
                    <span>MMSI Duplicates (${data.conflicts.mmsi_duplicates.length})</span>
                </div>
            `;

            data.conflicts.mmsi_duplicates.forEach(conflict => {
                const card = this.createConflictCard(
                    `MMSI: ${conflict.mmsi}`,
                    `This MMSI appears in ${conflict.count} different lists`,
                    conflict.vessels
                );
                section.appendChild(card);
            });

            content.appendChild(section);
        }

        if (data.conflicts.imo_duplicates.length > 0) {
            const section = document.createElement('div');
            section.className = 'conflict-section';
            section.innerHTML = `
                <div class="conflict-section-header">
                    <span class="icon">🔄</span>
                    <span>IMO Duplicates (${data.conflicts.imo_duplicates.length})</span>
                </div>
            `;

            data.conflicts.imo_duplicates.forEach(conflict => {
                const card = this.createConflictCard(
                    `IMO: ${conflict.imo}`,
                    `This IMO appears in ${conflict.count} different lists`,
                    conflict.vessels
                );
                section.appendChild(card);
            });

            content.appendChild(section);
        }

        if (data.conflicts.mmsi_imo_inconsistencies.length > 0) {
            const section = document.createElement('div');
            section.className = 'conflict-section';
            section.innerHTML = `
                <div class="conflict-section-header">
                    <span class="icon">⚡</span>
                    <span>MMSI-IMO Inconsistencies (${data.conflicts.mmsi_imo_inconsistencies.length})</span>
                </div>
            `;

            data.conflicts.mmsi_imo_inconsistencies.forEach(conflict => {
                const card = this.createConflictCard(
                    `MMSI: ${conflict.mmsi}`,
                    `This MMSI is paired with different IMO numbers: ${conflict.imos.join(', ')}`,
                    conflict.vessels
                );
                section.appendChild(card);
            });

            content.appendChild(section);
        }
    },

    createConflictCard(title, description, vessels) {
        const card = document.createElement('div');
        card.className = 'conflict-card';

        const uniqueLists = [...new Set(vessels.map(v => v.list_name))];

        card.innerHTML = `
            <div style="font-weight: 600; font-size: 1.05rem; margin-bottom: 0.5rem;">${title}</div>
            <div style="opacity: 0.8; margin-bottom: 0.75rem;">${description}</div>
            <div class="conflict-detail">
                <div class="conflict-list-tags">
                    ${uniqueLists.map(listName => {
            const vessel = vessels.find(v => v.list_name === listName);
            return `
                            <span class="conflict-list-tag" style="border-color: ${vessel.list_color};">
                                <span class="list-badge" style="background-color: ${vessel.list_color};"></span>
                                ${listName}
                            </span>
                        `;
        }).join('')}
                </div>
                <div class="conflict-vessels">
                    ${vessels.map(vessel => `
                        <div class="conflict-vessel-item" style="border-left-color: ${vessel.list_color};">
                            <div class="conflict-vessel-info">
                                <div><strong>MMSI:</strong> ${vessel.mmsi} ${vessel.imo ? `| <strong>IMO:</strong> ${vessel.imo}` : ''}</div>
                                <div style="font-size: 0.85rem; opacity: 0.7; margin-top: 0.25rem;">
                                    in <span style="color: ${vessel.list_color};">${vessel.list_name}</span>
                                </div>
                            </div>
                            <button class="action-btn edit-btn" data-vessel-id="${vessel.id}" title="Edit">✎</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        card.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const vesselId = parseInt(btn.dataset.vesselId);
                const vessel = vessels.find(v => v.id === vesselId);
                const list = this.state.lists.find(l => l.id === vessel.list_id);
                if (list) {
                    this.state.currentList = list;
                    this.elements.conflictsModal.classList.remove('open');
                    this.openListModal(list);
                }
            });
        });

        return card;
    },

    async loadLists() {
        try {
            this.state.lists = await api.getLists();
            this.render();
        } catch (err) {
            console.error(err);
        }
    },

    render() {
        this.elements.grid.innerHTML = '';
        this.state.lists.forEach(list => {
            const card = document.createElement('div');
            card.className = 'card';

            const hasConflicts = this.state.conflictedLists.has(list.id);
            if (hasConflicts) {
                card.classList.add('has-conflicts');
            }

            let isEditing = false;

            const renderCardContent = () => {
                card.innerHTML = `
                    ${hasConflicts ? '<div class="conflict-warning-icon">⚠️</div>' : ''}
                    <div class="card-header">
                        <span class="card-title">
                            <span class="list-badge" style="background-color: ${list.color}"></span>
                            ${list.name}
                        </span>
                        <div style="display: flex; gap: 0.5rem;">
                            <button class="action-btn edit-list-btn" title="Edit List">✎</button>
                            <button class="delete-btn" data-id="${list.id}" title="Delete List">×</button>
                        </div>
                    </div>
                    <div class="card-body">
                         <p style="font-size: 0.9rem; opacity: 0.7; margin-bottom: 1rem;">
                            ${list.vessel_count || 0} Vessels
                            ${hasConflicts ? '<span style="color: #ef4444; margin-left: 0.5rem;">⚠️ Has Conflicts</span>' : ''}
                         </p>
                        <button class="btn btn-secondary view-btn" data-id="${list.id}">Manage Vessels</button>
                    </div>
                `;

                card.querySelector('.delete-btn').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm('Delete this list?')) {
                        await api.deleteList(list.id);
                        this.loadLists();
                        analytics.loadStats();
                    }
                });

                card.querySelector('.view-btn').addEventListener('click', () => {
                    this.state.currentList = list;
                    this.openListModal(list);
                });

                card.querySelector('.edit-list-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    isEditing = true;
                    renderEditForm();
                });
            };

            const renderEditForm = () => {
                card.innerHTML = `
                    <form class="card-body" style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <input type="text" value="${list.name}" id="edit-list-name-${list.id}" required />
                        <div style="display: flex; gap: 0.5rem; align-items: center;">
                            <input type="color" value="${list.color}" id="edit-list-color-${list.id}" style="width: 40px; height: 40px; border: none; background: transparent; cursor: pointer;" />
                            <span style="font-size: 0.8rem; opacity: 0.7;">Pick Color</span>
                        </div>
                        <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                            <button type="submit" class="btn" style="flex: 1;">Save</button>
                            <button type="button" class="btn btn-secondary cancel-edit" style="flex: 1;">Cancel</button>
                        </div>
                    </form>
                `;

                const form = card.querySelector('form');
                form.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const newName = document.getElementById(`edit-list-name-${list.id}`).value;
                    const newColor = document.getElementById(`edit-list-color-${list.id}`).value;
                    try {
                        await api.updateList(list.id, newName, newColor);
                        isEditing = false;
                        this.loadLists();
                    } catch (err) {
                        alert(err.message);
                    }
                });

                card.querySelector('.cancel-edit').addEventListener('click', () => {
                    isEditing = false;
                    renderCardContent();
                });
            };

            renderCardContent();
            this.elements.grid.appendChild(card);
        });
    },

    openCreateModal() {
        this.elements.createModal.classList.add('open');
    },

    closeCreateModal() {
        this.elements.createModal.classList.remove('open');
        this.elements.listForm.reset();
        document.querySelectorAll('.color-option').forEach(el => el.classList.remove('selected'));
    },

    async openListModal(list) {
        this.elements.listDetails.innerHTML = 'Loading...';
        document.getElementById('modal-list-title').textContent = list.name;
        this.elements.listModal.classList.add('open');
        this.loadListDetails(list.id);
    },

    async loadListDetails(listId) {
        try {
            const vessels = await api.getVessels(listId);
            this.elements.listDetails.innerHTML = '';

            if (vessels.length === 0) {
                this.elements.listDetails.innerHTML = '<p style="opacity: 0.5; text-align: center; padding: 1rem;">No vessels in list</p>';
                return;
            }

            const table = document.createElement('table');
            table.className = 'vessel-table';
            table.innerHTML = `
                <thead>
                    <tr>
                        <th style="width: 12%;">MMSI</th>
                        <th style="width: 10%;">IMO</th>
                        <th style="width: 15%;">Name</th>
                        <th style="width: 10%;">Callsign</th>
                        <th style="width: 6%;">Flag</th>
                        <th style="width: 32%;">Last Position</th>
                        <th style="width: 15%; text-align: right;">Actions</th>
                    </tr>
                </thead>
                <tbody></tbody>
            `;
            const tbody = table.querySelector('tbody');

            vessels.forEach(v => {
                const tr = document.createElement('tr');
                this.renderVesselRow(tr, v, listId);
                tbody.appendChild(tr);
            });
            this.elements.listDetails.appendChild(table);
        } catch (err) {
            this.elements.listDetails.innerHTML = 'Error loading vessels';
        }
    },

    renderVesselRow(tr, v, listId) {
        let positionHtml = '-';
        if (v.lastposition) {
            try {
                const pos = JSON.parse(v.lastposition);
                const lat = pos.lat?.toFixed(4) || '-';
                const lon = pos.lon?.toFixed(4) || '-';
                const speed = pos.speed !== undefined ? `${pos.speed} kn` : '';
                const course = pos.course !== undefined ? `${pos.course}°` : '';
                const timestamp = pos.timestamp ? new Date(pos.timestamp).toLocaleString() : '';

                let tooltipParts = [];
                if (pos.speed !== undefined) tooltipParts.push(`Speed: ${pos.speed} kn`);
                if (pos.course !== undefined) tooltipParts.push(`Course: ${pos.course}°`);
                if (pos.heading !== undefined) tooltipParts.push(`Heading: ${pos.heading}°`);
                if (pos.status !== undefined) tooltipParts.push(`Status: ${pos.status}`);
                if (pos.destination) tooltipParts.push(`Dest: ${pos.destination}`);
                if (timestamp) tooltipParts.push(`Updated: ${timestamp}`);

                const tooltip = tooltipParts.length > 0 ? tooltipParts.join('\n') : '';

                positionHtml = `
                    <span class="position-data" title="${tooltip}" style="cursor: help;">
                        <span class="pos-coords">${lat}, ${lon}</span>
                        ${speed ? `<span class="pos-speed" style="opacity: 0.7; font-size: 0.85em; margin-left: 0.5em;">${speed}</span>` : ''}
                    </span>
                `;
            } catch (e) {
                positionHtml = v.lastposition; // fallback to raw string
            }
        }

        tr.innerHTML = `
            <td>${v.mmsi || '-'}</td>
            <td>${v.imo || '-'}</td>
            <td>${v.name || '-'}</td>
            <td>${v.callsign || '-'}</td>
            <td>${v.flag || '-'}</td>
            <td class="position-cell">${positionHtml}</td>
            <td style="text-align: right;">
                <button class="action-btn edit-btn" title="Edit">✎</button>
                <button class="action-btn delete-btn" title="Delete">×</button>
            </td>
        `;

        tr.querySelector('.delete-btn').addEventListener('click', async () => {
            if (confirm('Remove vessel?')) {
                await api.deleteVessel(v.id);
                this.loadListDetails(listId);
                analytics.loadStats();
            }
        });

        tr.querySelector('.edit-btn').addEventListener('click', () => {
            this.enableVesselEditMode(tr, v, listId);
        });
    },

    enableVesselEditMode(tr, v, listId) {
        tr.innerHTML = `
            <td><input class="vessel-edit-input" type="text" value="${v.mmsi || ''}" placeholder="MMSI"></td>
            <td><input class="vessel-edit-input" type="text" value="${v.imo || ''}" placeholder="IMO"></td>
            <td><input class="vessel-edit-input" type="text" value="${v.name || ''}" placeholder="Name"></td>
            <td><input class="vessel-edit-input" type="text" value="${v.callsign || ''}" placeholder="Callsign"></td>
            <td><input class="vessel-edit-input" type="text" value="${v.flag || ''}" placeholder="Flag" style="width: 50px;"></td>
            <td><span style="opacity: 0.5; font-size: 0.85em;">Position auto-updated</span></td>
            <td style="text-align: right; white-space: nowrap;">
                <button class="action-btn save-vessel-btn" style="color: #4ade80;">✓</button>
                <button class="action-btn cancel-vessel-btn" style="color: #ef4444;">✕</button>
            </td>
        `;

        const mmsiInput = tr.querySelector('input[placeholder="MMSI"]');
        const imoInput = tr.querySelector('input[placeholder="IMO"]');
        const nameInput = tr.querySelector('input[placeholder="Name"]');
        const callsignInput = tr.querySelector('input[placeholder="Callsign"]');
        const flagInput = tr.querySelector('input[placeholder="Flag"]');

        const save = async () => {
            try {
                await api.updateVessel(v.id, mmsiInput.value, imoInput.value, nameInput.value, callsignInput.value, flagInput.value);
                this.loadListDetails(listId);
            } catch (err) {
                alert(err.message);
            }
        };

        tr.querySelector('.save-vessel-btn').addEventListener('click', save);
        [mmsiInput, imoInput, nameInput, callsignInput, flagInput].forEach(input => {
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
        });

        tr.querySelector('.cancel-vessel-btn').addEventListener('click', () => {
            this.renderVesselRow(tr, v, listId);
        });
    },

    closeListModal() {
        this.elements.listModal.classList.remove('open');
        this.state.currentList = null;
        this.loadLists(); // Refresh counts on close
    }
};
