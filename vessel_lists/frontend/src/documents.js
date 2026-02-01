import { api } from './api.js';

export const documents = {
    currentMMSI: null,
    currentPage: 1,
    pageSize: 20,

    async loadDocuments(mmsi, page = 1) {
        try {
            const data = await api.getDocuments(mmsi, page, this.pageSize);
            this.currentMMSI = mmsi;
            this.currentPage = page;
            this.renderDocuments(data);
        } catch (error) {
            console.error('Failed to load documents:', error);
            alert('Failed to load documents: ' + error.message);
        }
    },

    renderDocuments(data) {
        const container = document.getElementById('page-documents-list');

        if (data.total === 0) {
            container.innerHTML = '<p style="text-align: center; opacity: 0.7; padding: 3rem;">No documents found for this MMSI</p>';
            document.getElementById('documents-count').textContent = '0';
            return;
        }

        document.getElementById('documents-count').textContent = data.total;

        container.innerHTML = `
            ${data.documents.map(doc => `
                <div class="document-card">
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <div style="flex: 1;">
                            <div style="display: flex; gap: 1rem; align-items: center; margin-bottom: 0.5rem;">
                                <strong style="font-size: 1.1rem;">📄 Document #${doc.id}</strong>
                                <span style="opacity: 0.7; font-size: 0.9rem;">${new Date(doc.timestamp).toLocaleString()}</span>
                            </div>
                            <div class="document-preview">
                                ${Object.entries(doc.preview).map(([key, value]) => `
                                    <span class="preview-tag"><strong>${key}:</strong> ${String(value).substring(0, 50)}${String(value).length > 50 ? '...' : ''}</span>
                                `).join('')}
                            </div>
                        </div>
                        <div style="display: flex; gap: 0.5rem;">
                            <button class="btn btn-secondary" onclick="documentsModule.viewDocument(${doc.id})" style="padding: 0.5rem 1rem;">👁️ View</button>
                            <button class="btn btn-secondary" onclick="documentsModule.editDocument(${doc.id})" style="padding: 0.5rem 1rem;">✏️ Edit</button>
                            <button class="btn" onclick="documentsModule.deleteDocument(${doc.id})" style="padding: 0.5rem 1rem; background: #ef4444;">🗑️</button>
                        </div>
                    </div>
                </div>
            `).join('')}
            
            ${this.renderPagination(data)}
        `;
    },

    renderPagination(data) {
        if (data.pages <= 1) return '';

        return `
            <div class="pagination">
                <button ${data.page === 1 ? 'disabled' : ''} onclick="documentsModule.loadDocuments('${this.currentMMSI}', ${data.page - 1})">Previous</button>
                <span>Page ${data.page} of ${data.pages}</span>
                <button ${data.page === data.pages ? 'disabled' : ''} onclick="documentsModule.loadDocuments('${this.currentMMSI}', ${data.page + 1})">Next</button>
            </div>
        `;
    },

    async viewDocument(id) {
        try {
            const doc = await api.getDocument(id);
            this.showDocumentDetail(doc);
        } catch (error) {
            alert('Failed to load document: ' + error.message);
        }
    },

    showDocumentDetail(doc) {
        const modal = document.getElementById('document-detail-modal');
        const content = document.getElementById('document-detail-content');

        document.getElementById('document-detail-title').textContent = `Document #${doc.id} - MMSI: ${doc.mmsi}`;
        document.getElementById('document-detail-timestamp').textContent = new Date(doc.timestamp).toLocaleString();

        content.innerHTML = `
            <table class="detail-table">
                <thead>
                    <tr>
                        <th style="width: 40%;">Key</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(doc.json_data).map(([key, value]) => `
                        <tr>
                            <td><strong>${key}</strong></td>
                            <td>${typeof value === 'object' ? JSON.stringify(value, null, 2) : value}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        document.getElementById('export-json-btn').onclick = () => this.exportDocument(doc.id, 'json');
        document.getElementById('export-csv-btn').onclick = () => this.exportDocument(doc.id, 'csv');

        modal.classList.add('open');
    },

    async editDocument(id) {
        try {
            const doc = await api.getDocument(id);
            const newData = prompt('Edit JSON data:', JSON.stringify(doc.json_data, null, 2));

            if (newData) {
                const parsedData = JSON.parse(newData);
                await api.updateDocument(id, parsedData);
                alert('Document updated successfully');
                this.loadDocuments(this.currentMMSI, this.currentPage);
            }
        } catch (error) {
            alert('Failed to update document: ' + error.message);
        }
    },

    async deleteDocument(id) {
        if (!confirm('Are you sure you want to delete this document?')) return;

        try {
            await api.deleteDocument(id);
            alert('Document deleted successfully');
            this.loadDocuments(this.currentMMSI, this.currentPage);
        } catch (error) {
            alert('Failed to delete document: ' + error.message);
        }
    },

    async exportDocument(id, format) {
        try {
            const blob = await api.exportDocument(id, format);
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `document_${id}.${format}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            alert('Export failed: ' + error.message);
        }
    },

    bindEvents() {
        document.getElementById('document-search-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const mmsi = document.getElementById('document-search-mmsi').value.trim();
            if (mmsi) {
                this.loadDocuments(mmsi);
            }
        });

        document.getElementById('close-document-detail').addEventListener('click', () => {
            document.getElementById('document-detail-modal').classList.remove('open');
        });

        document.getElementById('create-document-btn').addEventListener('click', () => {
            this.showCreateDocumentForm();
        });
    },

    showCreateDocumentForm() {
        const mmsi = prompt('Enter MMSI:');
        if (!mmsi) return;

        const jsonData = prompt('Enter JSON data:', '{\n  "key": "value"\n}');
        if (!jsonData) return;

        try {
            const parsedData = JSON.parse(jsonData);
            this.createDocument(mmsi, parsedData);
        } catch (error) {
            alert('Invalid JSON: ' + error.message);
        }
    },

    async createDocument(mmsi, jsonData) {
        try {
            await api.createDocument(mmsi, jsonData);
            alert('Document created successfully');
            if (this.currentMMSI === mmsi) {
                this.loadDocuments(mmsi, 1);
            }
        } catch (error) {
            alert('Failed to create document: ' + error.message);
        }
    },

    init() {
        this.bindEvents();
    }
};

window.documentsModule = documents;
