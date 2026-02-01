(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))n(i);new MutationObserver(i=>{for(const o of i)if(o.type==="childList")for(const a of o.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&n(a)}).observe(document,{childList:!0,subtree:!0});function s(i){const o={};return i.integrity&&(o.integrity=i.integrity),i.referrerPolicy&&(o.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?o.credentials="include":i.crossOrigin==="anonymous"?o.credentials="omit":o.credentials="same-origin",o}function n(i){if(i.ep)return;i.ep=!0;const o=s(i);fetch(i.href,o)}})();const r="",d={getLists:async()=>{const e=await fetch(`${r}/lists/`);if(!e.ok)throw new Error("Failed to fetch lists");return e.json()},createList:async(e,t)=>{const s=await fetch(`${r}/lists/`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:e,color:t})});if(!s.ok)throw new Error("Failed to create list");return s.json()},updateList:async(e,t,s)=>{const n=await fetch(`${r}/lists/${e}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:t,color:s})});if(!n.ok)throw new Error("Failed to update list");return n.json()},deleteList:async e=>{const t=await fetch(`${r}/lists/${e}`,{method:"DELETE"});if(!t.ok)throw new Error("Failed to delete list");return t.json()},getVessels:async e=>{const t=e?`${r}/vessels/?list_id=${e}`:`${r}/vessels/`,s=await fetch(t);if(!s.ok)throw new Error("Failed to fetch vessels");return s.json()},getConflicts:async()=>{const e=await fetch(`${r}/vessels/conflicts`);if(!e.ok)throw new Error("Failed to fetch conflicts");return e.json()},createVessel:async(e,t,s,n,i,o,a,l)=>{const c=await fetch(`${r}/vessels/`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mmsi:e,imo:t,name:s,callsign:n,flag:i,lastposition:o,note:a,list_id:l})});if(!c.ok)throw new Error("Failed to add vessel");return c.json()},createVesselBulk:async(e,t,s,n,i,o,a,l)=>{const c=await fetch(`${r}/vessels/bulk`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mmsi:e,imo:t,name:s,callsign:n,flag:i,lastposition:o,note:a,list_ids:l})});if(!c.ok)throw new Error("Failed to add vessel to lists");return c.json()},updateVessel:async(e,t,s,n,i,o,a,l)=>{const c={};t!==void 0&&(c.mmsi=t),s!==void 0&&(c.imo=s),n!==void 0&&(c.name=n),i!==void 0&&(c.callsign=i),o!==void 0&&(c.flag=o),a!==void 0&&(c.lastposition=a),l!==void 0&&(c.note=l);const m=await fetch(`${r}/vessels/${e}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(c)});if(!m.ok)throw new Error("Failed to update vessel");return m.json()},searchVessels:async e=>{const t=await fetch(`${r}/vessels/search?q=${encodeURIComponent(e)}`);if(!t.ok)throw new Error("Failed to search vessels");return t.json()},deleteVessel:async e=>{const t=await fetch(`${r}/vessels/${e}`,{method:"DELETE"});if(!t.ok)throw new Error("Failed to delete vessel");return t.json()},getStats:async()=>{const e=await fetch(`${r}/analytics/stats`);if(!e.ok)throw new Error("Failed to fetch stats");return e.json()},exportListCSV:async e=>{const t=await fetch(`${r}/analytics/export/list/${e}`);if(!t.ok)throw new Error("Failed to export CSV");return await t.blob()},getAvailableFlags:async()=>{const e=await fetch(`${r}/analytics/filters/flags`);if(!e.ok)throw new Error("Failed to fetch flags");return e.json()},advancedSearch:async e=>{const t=new URLSearchParams;Object.keys(e).forEach(n=>{e[n]!==null&&e[n]!==void 0&&e[n]!==""&&t.append(n,e[n])});const s=await fetch(`${r}/analytics/vessels/advanced-search?${t}`);if(!s.ok)throw new Error("Failed to search vessels");return s.json()},getAggregatedVessels:async()=>{const e=await fetch(`${r}/analytics/vessels/aggregated`);if(!e.ok)throw new Error("Failed to fetch aggregated vessels");return e.json()},exportAggregatedCSV:async()=>{const e=await fetch(`${r}/analytics/export/aggregated`);if(!e.ok)throw new Error("Failed to export aggregated CSV");return await e.blob()},getDocuments:async(e,t=1,s=20)=>{const n=await fetch(`${r}/documents/?mmsi=${encodeURIComponent(e)}&page=${t}&size=${s}`);if(!n.ok)throw new Error("Failed to fetch documents");return n.json()},getDocument:async e=>{const t=await fetch(`${r}/documents/${e}`);if(!t.ok)throw new Error("Failed to fetch document");return t.json()},createDocument:async(e,t)=>{const s=await fetch(`${r}/documents/`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mmsi:e,json_data:t})});if(!s.ok)throw new Error("Failed to create document");return s.json()},updateDocument:async(e,t)=>{const s=await fetch(`${r}/documents/${e}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({json_data:t})});if(!s.ok)throw new Error("Failed to update document");return s.json()},deleteDocument:async e=>{const t=await fetch(`${r}/documents/${e}`,{method:"DELETE"});if(!t.ok)throw new Error("Failed to delete document");return t.json()},getDocumentCount:async e=>{const t=await fetch(`${r}/documents/count/${encodeURIComponent(e)}`);if(!t.ok)throw new Error("Failed to get document count");return t.json()},exportDocument:async(e,t="json")=>{const s=await fetch(`${r}/documents/export/${e}?format=${t}`);if(!s.ok)throw new Error("Failed to export document");return await s.blob()}};async function v(e){const s=(await e.text()).split(/\r?\n/);if(s.length<2)return[];const n=s[0].toLowerCase().split(",").map(l=>l.trim()),i=n.indexOf("mmsi"),o=n.indexOf("imo");if(i===-1)throw new Error('CSV must contain an "mmsi" column');const a=[];for(let l=1;l<s.length;l++){const c=s[l].trim();if(!c)continue;const m=c.split(",").map(f=>f.trim()),u=m[i],h=o!==-1?m[o]:null;u&&a.push({mmsi:u,imo:h})}return a}const p={async loadStats(){try{const e=await d.getStats();document.getElementById("stat-lists").textContent=e.overview.total_lists,document.getElementById("stat-vessels").textContent=e.overview.total_vessels,document.getElementById("stat-flags").textContent=e.overview.unique_flags,document.getElementById("stat-imo").textContent=e.overview.with_imo,document.getElementById("stat-position").textContent=e.overview.with_position;const t=document.getElementById("filter-flag"),s=document.getElementById("filter-list");e.flags.forEach(n=>{const i=document.createElement("option");i.value=n.flag,i.textContent=`${n.flag} (${n.count})`,t.appendChild(i)}),e.lists.forEach(n=>{const i=document.createElement("option");i.value=n.name,i.textContent=`${n.name} (${n.vessel_count})`,i.dataset.listId=n.vessel_count,s.appendChild(i)})}catch(e){console.error("Failed to load stats:",e)}},bindAdvancedSearch(){const e=document.getElementById("advanced-search-btn"),t=document.getElementById("clear-filters-btn");e.addEventListener("click",async()=>{const s={mmsi:document.getElementById("filter-mmsi").value,imo:document.getElementById("filter-imo").value,name:document.getElementById("filter-name").value,flag:document.getElementById("filter-flag").value,has_imo:document.getElementById("filter-has-imo").value};try{const n=await d.advancedSearch(s);this.renderSearchResults(n),document.getElementById("list-grid").style.display="none"}catch(n){alert("Search failed: "+n.message)}}),t.addEventListener("click",()=>{document.getElementById("filter-mmsi").value="",document.getElementById("filter-imo").value="",document.getElementById("filter-name").value="",document.getElementById("filter-flag").value="",document.getElementById("filter-list").value="",document.getElementById("filter-has-imo").value="",document.getElementById("search-results").innerHTML="",document.getElementById("list-grid").style.display="grid"})},renderSearchResults(e){const t=document.getElementById("search-results");if(e.length===0){t.innerHTML='<p style="opacity: 0.7; text-align: center; padding: 2rem;">No vessels found matching your criteria.</p>';return}t.innerHTML=`
            <div style="background: var(--card-bg); border: var(--card-border); border-radius: 0.75rem; padding: 1rem; margin-bottom: 1rem;">
                <strong>${e.length} vessel(s) found</strong>
            </div>
        `;const s=document.createElement("div");s.className="search-results",e.forEach(n=>{const i=document.createElement("div");i.className="search-result-item",i.style.borderLeftColor=n.list_color,i.innerHTML=`
                <div class="search-result-info">
                    <div><strong>MMSI:</strong> ${n.mmsi} ${n.imo?`| <strong>IMO:</strong> ${n.imo}`:""}</div>
                    ${n.name?`<div><strong>Name:</strong> ${n.name}</div>`:""}
                    ${n.flag?`<div><strong>Flag:</strong> ${n.flag}</div>`:""}
                    <div style="margin-top: 0.5rem;">
                        <span class="search-result-badge" style="background-color: ${n.list_color}33;">
                            <span class="list-badge" style="background-color: ${n.list_color}"></span>
                            ${n.list_name}
                        </span>
                    </div>
                </div>
            `,s.appendChild(i)}),t.appendChild(s)},async exportListCSV(e,t){try{const s=await d.exportListCSV(e),n=window.URL.createObjectURL(s),i=document.createElement("a");i.href=n,i.download=`${t.replace(/\s+/g,"_")}.csv`,document.body.appendChild(i),i.click(),window.URL.revokeObjectURL(n),document.body.removeChild(i)}catch(s){alert("Export failed: "+s.message)}},bindAllVessels(){document.getElementById("page-export-aggregated-btn").addEventListener("click",async()=>{try{const t=await d.exportAggregatedCSV(),s=window.URL.createObjectURL(t),n=document.createElement("a");n.href=s,n.download="aggregated_vessels.csv",document.body.appendChild(n),n.click(),window.URL.revokeObjectURL(s),document.body.removeChild(n)}catch(t){alert("Export failed: "+t.message)}})},async loadAggregatedVessels(){try{const e=await d.getAggregatedVessels();document.getElementById("page-total-unique-vessels").textContent=e.total_unique_vessels;const t=document.getElementById("page-aggregated-vessels-content");if(e.vessels.length===0){t.innerHTML='<p style="text-align: center; opacity: 0.7; padding: 3rem;">No vessels found</p>';return}t.innerHTML=e.vessels.map(s=>`
                <div class="aggregated-vessel-item">
                    <div class="vessel-info-row">
                        <div>
                            <strong style="font-size: 1.1rem;">${s.mmsi||"N/A"}</strong>
                            ${s.imo?`<span style="opacity: 0.7; margin-left: 0.5rem;">IMO: ${s.imo}</span>`:""}
                        </div>
                        <div style="display: flex; gap: 1rem; flex-wrap: wrap; align-items: center;">
                            ${s.name?`<span><strong>Name:</strong> ${s.name}</span>`:""}
                            ${s.flag?`<span><strong>Flag:</strong> ${s.flag}</span>`:""}
                        </div>
                        <div class="list-count-badge">
                            ${s.list_count} ${s.list_count===1?"List":"Lists"}
                        </div>
                    </div>
                    <div class="vessel-lists-badges">
                        ${s.lists.map(n=>`
                            <span class="search-result-badge" style="background-color: ${n.list_color}33;">
                                <span class="list-badge" style="background-color: ${n.list_color}"></span>
                                ${n.list_name}
                            </span>
                        `).join("")}
                    </div>
                </div>
            `).join("")}catch(e){console.error("Failed to load aggregated vessels:",e),alert("Failed to load vessels: "+e.message)}},init(){this.loadStats(),this.bindAdvancedSearch(),this.bindAllVessels()}},g={state:{lists:[],currentList:null,conflictedLists:new Set},elements:{grid:document.getElementById("list-grid"),createModal:document.getElementById("create-modal"),listModal:document.getElementById("list-modal"),createBtn:document.getElementById("create-btn"),closeCreateBtn:document.getElementById("close-create"),closeListBtn:document.getElementById("close-list"),listForm:document.getElementById("list-form"),listDetails:document.getElementById("list-details"),addVesselForm:document.getElementById("add-vessel-form"),csvInput:document.getElementById("csv-input"),uploadCsvBtn:document.getElementById("upload-csv-btn"),colorPalette:document.getElementById("color-palette"),colorInput:document.getElementById("list-color"),searchResults:document.getElementById("search-results"),quickAddBtn:document.getElementById("quick-add-vessel-btn"),quickAddModal:document.getElementById("quick-add-modal"),closeQuickAdd:document.getElementById("close-quick-add"),quickAddForm:document.getElementById("quick-add-form"),quickListsSelection:document.getElementById("quick-lists-selection")},init(){this.renderPalette(),this.bindEvents(),this.bindConflictEvents(),this.bindQuickAddEvents(),this.loadLists(),this.loadConflicts()},renderPalette(){const e=["#ef4444","#f97316","#f59e0b","#84cc16","#10b981","#06b6d4","#3b82f6","#6366f1","#8b5cf6","#d946ef","#f43f5e","#64748b"];this.elements.colorPalette.innerHTML="",e.forEach(t=>{const s=document.createElement("div");s.className="color-option",s.style.backgroundColor=t,s.onclick=()=>{document.querySelectorAll(".color-option").forEach(n=>n.classList.remove("selected")),s.classList.add("selected"),this.elements.colorInput.value=t},this.elements.colorPalette.appendChild(s)})},bindEvents(){this.elements.createBtn.addEventListener("click",()=>this.openCreateModal()),this.elements.closeCreateBtn.addEventListener("click",()=>this.closeCreateModal()),this.elements.closeListBtn.addEventListener("click",()=>this.closeListModal()),this.elements.colorInput.addEventListener("input",e=>{document.querySelectorAll(".color-option").forEach(t=>t.classList.remove("selected"))}),this.elements.listForm.addEventListener("submit",async e=>{e.preventDefault();const t=document.getElementById("list-name").value,s=this.elements.colorInput.value;try{await d.createList(t,s),this.closeCreateModal(),this.loadLists(),p.loadStats()}catch(n){alert(n.message)}}),this.elements.addVesselForm.addEventListener("submit",async e=>{if(e.preventDefault(),!this.state.currentList)return;const t=document.getElementById("vessel-mmsi").value,s=document.getElementById("vessel-imo").value,n=document.getElementById("vessel-name").value,i=document.getElementById("vessel-callsign")?.value||"",o=document.getElementById("vessel-flag").value,a=document.getElementById("vessel-lastposition").value,l=document.getElementById("vessel-note").value;try{await d.createVessel(t,s,n,i,o,a,l,this.state.currentList.id),document.getElementById("vessel-mmsi").value="",document.getElementById("vessel-imo").value="",document.getElementById("vessel-name").value="",document.getElementById("vessel-callsign")&&(document.getElementById("vessel-callsign").value=""),document.getElementById("vessel-flag").value="",document.getElementById("vessel-lastposition").value="",document.getElementById("vessel-note").value="";const c=document.getElementById("vessel-added-message");c&&(c.style.display="block",setTimeout(()=>{c.style.display="none"},2e3)),document.getElementById("vessel-mmsi").focus(),this.loadListDetails(this.state.currentList.id),p.loadStats()}catch(c){alert(c.message)}}),this.elements.uploadCsvBtn.addEventListener("click",async()=>{const e=this.elements.csvInput.files[0];if(!e)return alert("Please select a file");if(this.state.currentList)try{const t=await v(e);if(confirm(`Import ${t.length} vessels to ${this.state.currentList.name}?`)){for(const s of t)await d.createVessel(s.mmsi,s.imo,s.name,s.callsign,s.flag,s.lastposition,s.note,this.state.currentList.id);this.loadListDetails(this.state.currentList.id),this.elements.csvInput.value="",p.loadStats()}}catch(t){alert("Error parsing CSV: "+t.message)}})},bindSearchEvents(){const e=async()=>{const t=this.elements.searchInput.value.trim();if(t)try{const s=await d.searchVessels(t);this.renderSearchResults(s),this.elements.clearSearchBtn.style.display="inline-flex",this.elements.grid.style.display="none"}catch(s){this.elements.searchResults.innerHTML=`<p style="color: var(--accent-color);">Error: ${s.message}</p>`}};this.elements.searchBtn.addEventListener("click",e),this.elements.searchInput.addEventListener("keydown",t=>{t.key==="Enter"&&e()}),this.elements.clearSearchBtn.addEventListener("click",()=>{this.elements.searchInput.value="",this.elements.searchResults.innerHTML="",this.elements.clearSearchBtn.style.display="none",this.elements.grid.style.display="grid"})},renderSearchResults(e){if(e.length===0){this.elements.searchResults.innerHTML='<p style="opacity: 0.7;">No vessels found.</p>';return}this.elements.searchResults.innerHTML="";const t=document.createElement("div");t.className="search-results",e.forEach(s=>{const n=document.createElement("div");n.className="search-result-item",this.renderSearchResultItem(n,s),t.appendChild(n)}),this.elements.searchResults.appendChild(t)},renderSearchResultItem(e,t){e.style.borderLeftColor=t.list_color,e.innerHTML=`
            <div class="search-result-info">
                <div><strong>MMSI:</strong> ${t.mmsi} ${t.imo?`| <strong>IMO:</strong> ${t.imo}`:""}</div>
                <div style="margin-top: 0.5rem;">
                    <span class="search-result-badge" style="background-color: ${t.list_color}33;">
                        <span class="list-badge" style="background-color: ${t.list_color}"></span>
                        ${t.list_name}
                    </span>
                </div>
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: center;">
                <button class="action-btn edit-search-btn" title="Edit">✎</button>
                <button class="action-btn delete-search-btn" title="Delete">×</button>
                <button class="btn btn-secondary view-list-btn" data-list-id="${t.list_id}">View List</button>
            </div>
        `,e.querySelector(".edit-search-btn").addEventListener("click",()=>{this.enableSearchResultEdit(e,t)}),e.querySelector(".delete-search-btn").addEventListener("click",async()=>{if(confirm("Remove this vessel?"))try{await d.deleteVessel(t.id),e.remove(),p.loadStats(),this.elements.searchResults.querySelector(".search-results").children.length===0&&(this.elements.searchResults.innerHTML='<p style="opacity: 0.7;">No vessels found.</p>')}catch(s){alert(s.message)}}),e.querySelector(".view-list-btn").addEventListener("click",async()=>{const s=this.state.lists.find(n=>n.id===t.list_id);s&&(this.state.currentList=s,this.openListModal(s))})},enableSearchResultEdit(e,t){e.innerHTML=`
            <div style="flex: 1; display: flex; gap: 0.5rem; align-items: center;">
                <div style="flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                    <input class="vessel-edit-input" type="text" value="${t.mmsi}" placeholder="MMSI" required>
                    <input class="vessel-edit-input" type="text" value="${t.imo||""}" placeholder="IMO">
                </div>
                <button class="action-btn" style="color: #4ade80;" title="Save">✓</button>
                <button class="action-btn" style="color: #ef4444;" title="Cancel">✕</button>
            </div>
        `;const s=e.querySelector('input[placeholder="MMSI"]'),n=e.querySelector('input[placeholder="IMO"]'),i=e.querySelector('.action-btn[title="Save"]'),o=e.querySelector('.action-btn[title="Cancel"]'),a=async()=>{try{const l=await d.updateVessel(t.id,s.value,n.value);t.mmsi=l.mmsi,t.imo=l.imo,this.renderSearchResultItem(e,t)}catch(l){alert(l.message)}};i.addEventListener("click",a),s.addEventListener("keydown",l=>{l.key==="Enter"&&a()}),n.addEventListener("keydown",l=>{l.key==="Enter"&&a()}),o.addEventListener("click",()=>this.renderSearchResultItem(e,t))},bindConflictEvents(){},bindQuickAddEvents(){this.elements.quickAddBtn.addEventListener("click",()=>{this.openQuickAddModal()}),this.elements.closeQuickAdd.addEventListener("click",()=>{this.closeQuickAddModal()}),document.getElementById("select-all-lists").addEventListener("click",()=>{document.querySelectorAll(".quick-list-checkbox").forEach(e=>e.checked=!0)}),document.getElementById("deselect-all-lists").addEventListener("click",()=>{document.querySelectorAll(".quick-list-checkbox").forEach(e=>e.checked=!1)}),this.elements.quickAddForm.addEventListener("submit",async e=>{e.preventDefault();const t=document.getElementById("quick-mmsi").value,s=document.getElementById("quick-imo").value,n=document.getElementById("quick-name").value,i=document.getElementById("quick-callsign")?.value||"",o=document.getElementById("quick-flag").value,a=document.getElementById("quick-lastposition").value,l=document.getElementById("quick-note").value,c=document.getElementById("keep-modal-open").checked,m=[];if(document.querySelectorAll(".quick-list-checkbox:checked").forEach(u=>{m.push(parseInt(u.value))}),m.length===0){alert("Please select at least one list");return}try{const u=await d.createVesselBulk(t,s,n,i,o,a,l,m);alert(`✓ Vessel added to ${u.created} list(s)`),c?(document.getElementById("quick-mmsi").value="",document.getElementById("quick-imo").value="",document.getElementById("quick-name").value="",document.getElementById("quick-callsign")&&(document.getElementById("quick-callsign").value=""),document.getElementById("quick-flag").value="",document.getElementById("quick-lastposition").value="",document.getElementById("quick-note").value="",document.getElementById("quick-mmsi").focus()):this.closeQuickAddModal(),this.loadLists(),this.loadConflicts(),p.loadStats()}catch(u){alert(u.message)}})},openQuickAddModal(){this.elements.quickListsSelection.innerHTML="",this.state.lists.forEach(e=>{const t=document.createElement("label");t.style.display="flex",t.style.alignItems="center",t.style.gap="0.5rem",t.style.padding="0.5rem",t.style.cursor="pointer",t.style.borderRadius="0.25rem",t.style.transition="background 0.2s",t.onmouseover=()=>t.style.background="rgba(255,255,255,0.05)",t.onmouseout=()=>t.style.background="transparent",t.innerHTML=`
                <input type="checkbox" class="quick-list-checkbox" value="${e.id}" style="width: auto; cursor: pointer;" />
                <span class="list-badge" style="background-color: ${e.color};"></span>
                <span>${e.name}</span>
            `,this.elements.quickListsSelection.appendChild(t)}),this.elements.quickAddModal.classList.add("open")},closeQuickAddModal(){this.elements.quickAddModal.classList.remove("open"),this.elements.quickAddForm.reset()},async loadConflicts(){try{const e=await d.getConflicts();this.state.conflictedLists.clear(),e.conflicts.mmsi_duplicates&&e.conflicts.mmsi_duplicates.forEach(n=>{n.vessels.forEach(i=>this.state.conflictedLists.add(i.list_id))}),e.conflicts.imo_duplicates&&e.conflicts.imo_duplicates.forEach(n=>{n.vessels.forEach(i=>this.state.conflictedLists.add(i.list_id))}),e.conflicts.mmsi_imo_inconsistencies&&e.conflicts.mmsi_imo_inconsistencies.forEach(n=>{n.vessels.forEach(i=>this.state.conflictedLists.add(i.list_id))});const t=document.getElementById("conflicts-badge-nav"),s=document.getElementById("conflicts-badge");e.total_conflicts>0?(t.textContent=e.total_conflicts,t.style.display="inline-block",s&&(s.textContent=e.total_conflicts,s.parentElement.style.display="flex"),document.getElementById("page-conflicts-overview").style.display="block",this.renderConflictsStats(e)):(t.style.display="none",s&&(s.parentElement.style.display="none"),document.getElementById("page-conflicts-overview").style.display="none"),this.renderConflicts(e),this.state.lists.length>0&&this.render()}catch(e){console.error("Error loading conflicts:",e)}},renderConflictsStats(e){const t=document.getElementById("page-conflicts-stats");t.innerHTML=`
            <div class="conflict-stat-card">
                <div class="conflict-stat-number">${e.total_conflicts}</div>
                <div class="conflict-stat-label">Total Conflicts</div>
            </div>
            <div class="conflict-stat-card">
                <div class="conflict-stat-number">${e.conflicts.mmsi_duplicates.length}</div>
                <div class="conflict-stat-label">MMSI Duplicates</div>
            </div>
            <div class="conflict-stat-card">
                <div class="conflict-stat-number">${e.conflicts.imo_duplicates.length}</div>
                <div class="conflict-stat-label">IMO Duplicates</div>
            </div>
            <div class="conflict-stat-card">
                <div class="conflict-stat-number">${e.conflicts.mmsi_imo_inconsistencies.length}</div>
                <div class="conflict-stat-label">Inconsistencies</div>
            </div>
            <div class="conflict-stat-card">
                <div class="conflict-stat-number">${this.state.conflictedLists.size}</div>
                <div class="conflict-stat-label">Affected Lists</div>
            </div>
        `},renderConflicts(e){const t=document.getElementById("page-conflicts-content");if(e.total_conflicts===0){t.innerHTML=`
                <div class="no-conflicts">
                    <div class="no-conflicts-icon">✅</div>
                    <h3>No Conflicts Detected</h3>
                    <p style="opacity: 0.7; margin-top: 0.5rem;">All vessel data is consistent across lists.</p>
                </div>
            `;return}if(t.innerHTML="",e.conflicts.mmsi_duplicates.length>0){const s=document.createElement("div");s.className="conflict-section",s.innerHTML=`
                <div class="conflict-section-header">
                    <span class="icon">🔄</span>
                    <span>MMSI Duplicates (${e.conflicts.mmsi_duplicates.length})</span>
                </div>
            `,e.conflicts.mmsi_duplicates.forEach(n=>{const i=this.createConflictCard(`MMSI: ${n.mmsi}`,`This MMSI appears in ${n.count} different lists`,n.vessels);s.appendChild(i)}),t.appendChild(s)}if(e.conflicts.imo_duplicates.length>0){const s=document.createElement("div");s.className="conflict-section",s.innerHTML=`
                <div class="conflict-section-header">
                    <span class="icon">🔄</span>
                    <span>IMO Duplicates (${e.conflicts.imo_duplicates.length})</span>
                </div>
            `,e.conflicts.imo_duplicates.forEach(n=>{const i=this.createConflictCard(`IMO: ${n.imo}`,`This IMO appears in ${n.count} different lists`,n.vessels);s.appendChild(i)}),t.appendChild(s)}if(e.conflicts.mmsi_imo_inconsistencies.length>0){const s=document.createElement("div");s.className="conflict-section",s.innerHTML=`
                <div class="conflict-section-header">
                    <span class="icon">⚡</span>
                    <span>MMSI-IMO Inconsistencies (${e.conflicts.mmsi_imo_inconsistencies.length})</span>
                </div>
            `,e.conflicts.mmsi_imo_inconsistencies.forEach(n=>{const i=this.createConflictCard(`MMSI: ${n.mmsi}`,`This MMSI is paired with different IMO numbers: ${n.imos.join(", ")}`,n.vessels);s.appendChild(i)}),t.appendChild(s)}},createConflictCard(e,t,s){const n=document.createElement("div");n.className="conflict-card";const i=[...new Set(s.map(o=>o.list_name))];return n.innerHTML=`
            <div style="font-weight: 600; font-size: 1.05rem; margin-bottom: 0.5rem;">${e}</div>
            <div style="opacity: 0.8; margin-bottom: 0.75rem;">${t}</div>
            <div class="conflict-detail">
                <div class="conflict-list-tags">
                    ${i.map(o=>{const a=s.find(l=>l.list_name===o);return`
                            <span class="conflict-list-tag" style="border-color: ${a.list_color};">
                                <span class="list-badge" style="background-color: ${a.list_color};"></span>
                                ${o}
                            </span>
                        `}).join("")}
                </div>
                <div class="conflict-vessels">
                    ${s.map(o=>`
                        <div class="conflict-vessel-item" style="border-left-color: ${o.list_color};">
                            <div class="conflict-vessel-info">
                                <div><strong>MMSI:</strong> ${o.mmsi} ${o.imo?`| <strong>IMO:</strong> ${o.imo}`:""}</div>
                                <div style="font-size: 0.85rem; opacity: 0.7; margin-top: 0.25rem;">
                                    in <span style="color: ${o.list_color};">${o.list_name}</span>
                                </div>
                            </div>
                            <button class="action-btn edit-btn" data-vessel-id="${o.id}" title="Edit">✎</button>
                        </div>
                    `).join("")}
                </div>
            </div>
        `,n.querySelectorAll(".edit-btn").forEach(o=>{o.addEventListener("click",async()=>{const a=parseInt(o.dataset.vesselId),l=s.find(m=>m.id===a),c=this.state.lists.find(m=>m.id===l.list_id);c&&(this.state.currentList=c,this.elements.conflictsModal.classList.remove("open"),this.openListModal(c))})}),n},async loadLists(){try{this.state.lists=await d.getLists(),this.render()}catch(e){console.error(e)}},render(){this.elements.grid.innerHTML="",this.state.lists.forEach(e=>{const t=document.createElement("div");t.className="card";const s=this.state.conflictedLists.has(e.id);s&&t.classList.add("has-conflicts");let n=!1;const i=()=>{t.innerHTML=`
                    ${s?'<div class="conflict-warning-icon">⚠️</div>':""}
                    <div class="card-header">
                        <span class="card-title">
                            <span class="list-badge" style="background-color: ${e.color}"></span>
                            ${e.name}
                        </span>
                        <div style="display: flex; gap: 0.5rem;">
                            <button class="action-btn edit-list-btn" title="Edit List">✎</button>
                            <button class="delete-btn" data-id="${e.id}" title="Delete List">×</button>
                        </div>
                    </div>
                    <div class="card-body">
                         <p style="font-size: 0.9rem; opacity: 0.7; margin-bottom: 1rem;">
                            ${e.vessel_count||0} Vessels
                            ${s?'<span style="color: #ef4444; margin-left: 0.5rem;">⚠️ Has Conflicts</span>':""}
                         </p>
                        <button class="btn btn-secondary view-btn" data-id="${e.id}">Manage Vessels</button>
                    </div>
                `,t.querySelector(".delete-btn").addEventListener("click",async a=>{a.stopPropagation(),confirm("Delete this list?")&&(await d.deleteList(e.id),this.loadLists(),p.loadStats())}),t.querySelector(".view-btn").addEventListener("click",()=>{this.state.currentList=e,this.openListModal(e)}),t.querySelector(".edit-list-btn").addEventListener("click",a=>{a.stopPropagation(),n=!0,o()})},o=()=>{t.innerHTML=`
                    <form class="card-body" style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <input type="text" value="${e.name}" id="edit-list-name-${e.id}" required />
                        <div style="display: flex; gap: 0.5rem; align-items: center;">
                            <input type="color" value="${e.color}" id="edit-list-color-${e.id}" style="width: 40px; height: 40px; border: none; background: transparent; cursor: pointer;" />
                            <span style="font-size: 0.8rem; opacity: 0.7;">Pick Color</span>
                        </div>
                        <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                            <button type="submit" class="btn" style="flex: 1;">Save</button>
                            <button type="button" class="btn btn-secondary cancel-edit" style="flex: 1;">Cancel</button>
                        </div>
                    </form>
                `,t.querySelector("form").addEventListener("submit",async l=>{l.preventDefault();const c=document.getElementById(`edit-list-name-${e.id}`).value,m=document.getElementById(`edit-list-color-${e.id}`).value;try{await d.updateList(e.id,c,m),n=!1,this.loadLists()}catch(u){alert(u.message)}}),t.querySelector(".cancel-edit").addEventListener("click",()=>{n=!1,i()})};i(),this.elements.grid.appendChild(t)})},openCreateModal(){this.elements.createModal.classList.add("open")},closeCreateModal(){this.elements.createModal.classList.remove("open"),this.elements.listForm.reset(),document.querySelectorAll(".color-option").forEach(e=>e.classList.remove("selected"))},async openListModal(e){this.elements.listDetails.innerHTML="Loading...",document.getElementById("modal-list-title").textContent=e.name,this.elements.listModal.classList.add("open"),this.loadListDetails(e.id)},async loadListDetails(e){try{const t=await d.getVessels(e);if(this.elements.listDetails.innerHTML="",t.length===0){this.elements.listDetails.innerHTML='<p style="opacity: 0.5; text-align: center; padding: 1rem;">No vessels in list</p>';return}const s=document.createElement("table");s.className="vessel-table",s.innerHTML=`
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
            `;const n=s.querySelector("tbody");t.forEach(i=>{const o=document.createElement("tr");this.renderVesselRow(o,i,e),n.appendChild(o)}),this.elements.listDetails.appendChild(s)}catch{this.elements.listDetails.innerHTML="Error loading vessels"}},renderVesselRow(e,t,s){let n="-";if(t.lastposition)try{const i=JSON.parse(t.lastposition),o=i.lat?.toFixed(4)||"-",a=i.lon?.toFixed(4)||"-",l=i.speed!==void 0?`${i.speed} kn`:"",c=i.course!==void 0?`${i.course}°`:"",m=i.timestamp?new Date(i.timestamp).toLocaleString():"";let u=[];i.speed!==void 0&&u.push(`Speed: ${i.speed} kn`),i.course!==void 0&&u.push(`Course: ${i.course}°`),i.heading!==void 0&&u.push(`Heading: ${i.heading}°`),i.status!==void 0&&u.push(`Status: ${i.status}`),i.destination&&u.push(`Dest: ${i.destination}`),m&&u.push(`Updated: ${m}`),n=`
                    <span class="position-data" title="${u.length>0?u.join(`
`):""}" style="cursor: help;">
                        <span class="pos-coords">${o}, ${a}</span>
                        ${l?`<span class="pos-speed" style="opacity: 0.7; font-size: 0.85em; margin-left: 0.5em;">${l}</span>`:""}
                    </span>
                `}catch{n=t.lastposition}e.innerHTML=`
            <td>${t.mmsi||"-"}</td>
            <td>${t.imo||"-"}</td>
            <td>${t.name||"-"}</td>
            <td>${t.callsign||"-"}</td>
            <td>${t.flag||"-"}</td>
            <td class="position-cell">${n}</td>
            <td style="text-align: right;">
                <button class="action-btn edit-btn" title="Edit">✎</button>
                <button class="action-btn delete-btn" title="Delete">×</button>
            </td>
        `,e.querySelector(".delete-btn").addEventListener("click",async()=>{confirm("Remove vessel?")&&(await d.deleteVessel(t.id),this.loadListDetails(s),p.loadStats())}),e.querySelector(".edit-btn").addEventListener("click",()=>{this.enableVesselEditMode(e,t,s)})},enableVesselEditMode(e,t,s){e.innerHTML=`
            <td><input class="vessel-edit-input" type="text" value="${t.mmsi||""}" placeholder="MMSI"></td>
            <td><input class="vessel-edit-input" type="text" value="${t.imo||""}" placeholder="IMO"></td>
            <td><input class="vessel-edit-input" type="text" value="${t.name||""}" placeholder="Name"></td>
            <td><input class="vessel-edit-input" type="text" value="${t.callsign||""}" placeholder="Callsign"></td>
            <td><input class="vessel-edit-input" type="text" value="${t.flag||""}" placeholder="Flag" style="width: 50px;"></td>
            <td><span style="opacity: 0.5; font-size: 0.85em;">Position auto-updated</span></td>
            <td style="text-align: right; white-space: nowrap;">
                <button class="action-btn save-vessel-btn" style="color: #4ade80;">✓</button>
                <button class="action-btn cancel-vessel-btn" style="color: #ef4444;">✕</button>
            </td>
        `;const n=e.querySelector('input[placeholder="MMSI"]'),i=e.querySelector('input[placeholder="IMO"]'),o=e.querySelector('input[placeholder="Name"]'),a=e.querySelector('input[placeholder="Callsign"]'),l=e.querySelector('input[placeholder="Flag"]'),c=async()=>{try{await d.updateVessel(t.id,n.value,i.value,o.value,a.value,l.value),this.loadListDetails(s)}catch(m){alert(m.message)}};e.querySelector(".save-vessel-btn").addEventListener("click",c),[n,i,o,a,l].forEach(m=>{m.addEventListener("keydown",u=>{u.key==="Enter"&&c()})}),e.querySelector(".cancel-vessel-btn").addEventListener("click",()=>{this.renderVesselRow(e,t,s)})},closeListModal(){this.elements.listModal.classList.remove("open"),this.state.currentList=null,this.loadLists()}},b={currentPage:"dashboard",init(){document.querySelectorAll(".nav-tab").forEach(e=>{e.addEventListener("click",()=>{const t=e.dataset.page;this.navigateTo(t)})})},navigateTo(e){document.querySelectorAll(".page-content").forEach(t=>{t.classList.remove("active")}),document.querySelectorAll(".nav-tab").forEach(t=>{t.classList.remove("active")}),document.getElementById(`page-${e}`).classList.add("active"),document.querySelector(`[data-page="${e}"]`).classList.add("active"),this.currentPage=e,this.onPageChange(e)},onPageChange(e){window.pageCallbacks&&window.pageCallbacks[e]&&window.pageCallbacks[e]()}},y={currentMMSI:null,currentPage:1,pageSize:20,async loadDocuments(e,t=1){try{const s=await d.getDocuments(e,t,this.pageSize);this.currentMMSI=e,this.currentPage=t,this.renderDocuments(s)}catch(s){console.error("Failed to load documents:",s),alert("Failed to load documents: "+s.message)}},renderDocuments(e){const t=document.getElementById("page-documents-list");if(e.total===0){t.innerHTML='<p style="text-align: center; opacity: 0.7; padding: 3rem;">No documents found for this MMSI</p>',document.getElementById("documents-count").textContent="0";return}document.getElementById("documents-count").textContent=e.total,t.innerHTML=`
            ${e.documents.map(s=>`
                <div class="document-card">
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <div style="flex: 1;">
                            <div style="display: flex; gap: 1rem; align-items: center; margin-bottom: 0.5rem;">
                                <strong style="font-size: 1.1rem;">📄 Document #${s.id}</strong>
                                <span style="opacity: 0.7; font-size: 0.9rem;">${new Date(s.timestamp).toLocaleString()}</span>
                            </div>
                            <div class="document-preview">
                                ${Object.entries(s.preview).map(([n,i])=>`
                                    <span class="preview-tag"><strong>${n}:</strong> ${String(i).substring(0,50)}${String(i).length>50?"...":""}</span>
                                `).join("")}
                            </div>
                        </div>
                        <div style="display: flex; gap: 0.5rem;">
                            <button class="btn btn-secondary" onclick="documentsModule.viewDocument(${s.id})" style="padding: 0.5rem 1rem;">👁️ View</button>
                            <button class="btn btn-secondary" onclick="documentsModule.editDocument(${s.id})" style="padding: 0.5rem 1rem;">✏️ Edit</button>
                            <button class="btn" onclick="documentsModule.deleteDocument(${s.id})" style="padding: 0.5rem 1rem; background: #ef4444;">🗑️</button>
                        </div>
                    </div>
                </div>
            `).join("")}
            
            ${this.renderPagination(e)}
        `},renderPagination(e){return e.pages<=1?"":`
            <div class="pagination">
                <button ${e.page===1?"disabled":""} onclick="documentsModule.loadDocuments('${this.currentMMSI}', ${e.page-1})">Previous</button>
                <span>Page ${e.page} of ${e.pages}</span>
                <button ${e.page===e.pages?"disabled":""} onclick="documentsModule.loadDocuments('${this.currentMMSI}', ${e.page+1})">Next</button>
            </div>
        `},async viewDocument(e){try{const t=await d.getDocument(e);this.showDocumentDetail(t)}catch(t){alert("Failed to load document: "+t.message)}},showDocumentDetail(e){const t=document.getElementById("document-detail-modal"),s=document.getElementById("document-detail-content");document.getElementById("document-detail-title").textContent=`Document #${e.id} - MMSI: ${e.mmsi}`,document.getElementById("document-detail-timestamp").textContent=new Date(e.timestamp).toLocaleString(),s.innerHTML=`
            <table class="detail-table">
                <thead>
                    <tr>
                        <th style="width: 40%;">Key</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(e.json_data).map(([n,i])=>`
                        <tr>
                            <td><strong>${n}</strong></td>
                            <td>${typeof i=="object"?JSON.stringify(i,null,2):i}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `,document.getElementById("export-json-btn").onclick=()=>this.exportDocument(e.id,"json"),document.getElementById("export-csv-btn").onclick=()=>this.exportDocument(e.id,"csv"),t.classList.add("open")},async editDocument(e){try{const t=await d.getDocument(e),s=prompt("Edit JSON data:",JSON.stringify(t.json_data,null,2));if(s){const n=JSON.parse(s);await d.updateDocument(e,n),alert("Document updated successfully"),this.loadDocuments(this.currentMMSI,this.currentPage)}}catch(t){alert("Failed to update document: "+t.message)}},async deleteDocument(e){if(confirm("Are you sure you want to delete this document?"))try{await d.deleteDocument(e),alert("Document deleted successfully"),this.loadDocuments(this.currentMMSI,this.currentPage)}catch(t){alert("Failed to delete document: "+t.message)}},async exportDocument(e,t){try{const s=await d.exportDocument(e,t),n=window.URL.createObjectURL(s),i=document.createElement("a");i.href=n,i.download=`document_${e}.${t}`,document.body.appendChild(i),i.click(),window.URL.revokeObjectURL(n),document.body.removeChild(i)}catch(s){alert("Export failed: "+s.message)}},bindEvents(){document.getElementById("document-search-form").addEventListener("submit",e=>{e.preventDefault();const t=document.getElementById("document-search-mmsi").value.trim();t&&this.loadDocuments(t)}),document.getElementById("close-document-detail").addEventListener("click",()=>{document.getElementById("document-detail-modal").classList.remove("open")}),document.getElementById("create-document-btn").addEventListener("click",()=>{this.showCreateDocumentForm()})},showCreateDocumentForm(){const e=prompt("Enter MMSI:");if(!e)return;const t=prompt("Enter JSON data:",`{
  "key": "value"
}`);if(t)try{const s=JSON.parse(t);this.createDocument(e,s)}catch(s){alert("Invalid JSON: "+s.message)}},async createDocument(e,t){try{await d.createDocument(e,t),alert("Document created successfully"),this.currentMMSI===e&&this.loadDocuments(e,1)}catch(s){alert("Failed to create document: "+s.message)}},init(){this.bindEvents()}};window.documentsModule=y;window.pageCallbacks={"all-vessels":()=>p.loadAggregatedVessels(),conflicts:()=>g.loadConflicts(),documents:()=>{}};document.addEventListener("DOMContentLoaded",()=>{g.init(),p.init(),b.init(),y.init()});
