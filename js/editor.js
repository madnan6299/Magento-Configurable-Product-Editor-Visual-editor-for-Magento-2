/**
 * Visual editor rendering for Magento spConfig attributes & options.
 */
const MagentoEditor = (() => {
  let sortableInstances = [];

  function destroySortables() {
    sortableInstances.forEach((s) => s.destroy());
    sortableInstances = [];
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str ?? '';
    return d.innerHTML;
  }

  function renderAttributes(container, state, callbacks) {
    destroySortables();
    container.innerHTML = '';

    const spConfig = MagentoCore.getSpConfig(state.data);
    if (!spConfig) {
      container.innerHTML = '<div class="empty-state"><p>Load Magento JSON to start editing</p></div>';
      return;
    }

    const attributes = spConfig.attributes;
    const sortedIds = MagentoCore.getSortedAttributeIds(attributes);

    const attrList = document.createElement('div');
    attrList.id = 'attr-sortable-list';

    sortedIds.forEach((attrId) => {
      attrList.appendChild(buildAttributeCard(attrId, attributes[attrId], state, callbacks));
    });

    container.appendChild(attrList);

    if (typeof Sortable !== 'undefined') {
      sortableInstances.push(
        new Sortable(attrList, {
          handle: '.drag-handle',
          animation: 150,
          onEnd(evt) {
            const ids = [...attrList.querySelectorAll('.attr-card')].map((el) => el.dataset.attrId);
            callbacks.onAttributeReorder(ids);
          },
        })
      );

      sortedIds.forEach((attrId) => {
        const list = document.getElementById(`opt-list-${attrId}`);
        if (!list) return;
        sortableInstances.push(
          new Sortable(list, {
            handle: '.opt-drag',
            animation: 150,
            onEnd(evt) {
              callbacks.onOptionReorder(attrId, evt.oldIndex, evt.newIndex);
            },
          })
        );
      });
    }
  }

  function buildAttributeCard(attrId, attr, state, callbacks) {
    const card = document.createElement('div');
    card.className = 'attr-card';
    card.dataset.attrId = attrId;

    const visibleCount = (attr.options ?? []).filter(
      (o) => !state.hidden.has(MagentoCore.optionNodeKey(attrId, o.id))
    ).length;

    const spConfig = MagentoCore.getSpConfig(state.data);
    const productCount = Object.values(spConfig?.index ?? {}).filter(
      (combo) => combo[attrId] !== undefined
    ).length;

    card.innerHTML = `
      <div class="attr-head">
        <span class="drag-handle" title="Drag to reorder">⠿</span>
        <div class="meta">
          <strong>${esc(attr.label)}</strong>
          <small>ID: ${esc(attrId)} · code: ${esc(attr.code)} · ${visibleCount}/${(attr.options ?? []).length} options · ${productCount} combos</small>
        </div>
        <button type="button" class="secondary graph-attr-btn" title="Show in relation graph">Graph</button>
        <button type="button" class="danger smart-remove-attr" title="Smart remove attribute + orphan options">Smart Remove</button>
        <button type="button" class="secondary toggle-collapse" title="Collapse">▼</button>
      </div>
      <div class="attr-body">
        <div class="field-row">
          <label>Label</label>
          <input type="text" class="attr-label" value="${esc(attr.label)}">
        </div>
        <div class="field-row">
          <label>Code</label>
          <input type="text" class="attr-code" value="${esc(attr.code ?? '')}">
        </div>
        <div class="field-row">
          <label>Position</label>
          <input type="text" class="attr-position" value="${esc(attr.position ?? '0')}">
        </div>
        <div class="option-list" id="opt-list-${attrId}"></div>
        <button type="button" class="secondary add-option-btn" style="margin-top:8px">+ Add Option</button>
      </div>
    `;

    const optList = card.querySelector(`#opt-list-${attrId}`);
    (attr.options ?? []).forEach((opt, i) => {
      optList.appendChild(buildOptionRow(attrId, opt, i, state, callbacks));
    });

    card.querySelector('.attr-label').addEventListener('change', (e) => {
      callbacks.onAttributeChange(attrId, 'label', e.target.value);
    });
    card.querySelector('.attr-code').addEventListener('change', (e) => {
      callbacks.onAttributeChange(attrId, 'code', e.target.value);
    });
    card.querySelector('.attr-position').addEventListener('change', (e) => {
      callbacks.onAttributeChange(attrId, 'position', e.target.value);
    });
    card.querySelector('.toggle-collapse').addEventListener('click', () => {
      card.classList.toggle('collapsed');
      card.querySelector('.toggle-collapse').textContent = card.classList.contains('collapsed') ? '▶' : '▼';
    });
    card.querySelector('.add-option-btn').addEventListener('click', () => {
      callbacks.onAddOption(attrId);
    });
    card.querySelector('.graph-attr-btn').addEventListener('click', () => {
      callbacks.onFocusAttributeInGraph(attrId);
    });
    card.querySelector('.smart-remove-attr').addEventListener('click', () => {
      callbacks.onSmartRemoveAttribute(attrId, attr.label, (attr.options ?? []).length, productCount);
    });

    return card;
  }

  function buildOptionRow(attrId, opt, index, state, callbacks) {
    const nodeKey = MagentoCore.optionNodeKey(attrId, opt.id);
    const hidden = state.hidden.has(nodeKey);
    const spConfig = MagentoCore.getSpConfig(state.data);
    const productCount = MagentoCore.getProductsForOption(spConfig, attrId, opt.id).length;
    const compound = MagentoCore.formatOptionCompound(opt);

    const row = document.createElement('div');
    row.className = 'option-row' + (hidden ? ' hidden-opt' : '');
    row.dataset.optionIndex = index;

    row.innerHTML = `
      <span class="opt-drag" title="Drag">⠿</span>
      <input type="text" class="opt-label" value="${esc(opt.label)}" ${hidden ? 'disabled' : ''}>
      <input type="text" class="opt-compound" value="${esc(compound)}" title="Format: id | value | extra" ${hidden ? 'disabled' : ''}>
      <span class="badge">${productCount} products</span>
      <div class="option-actions">
        <button type="button" class="secondary toggle-vis">${hidden ? 'Show' : 'Hide'}</button>
        <button type="button" class="secondary view-products" title="View product IDs">IDs</button>
        <button type="button" class="danger remove-opt">✕</button>
      </div>
    `;

    const idsPreview = document.createElement('div');
    idsPreview.className = 'product-ids-preview';
    idsPreview.style.display = 'none';
    row.appendChild(idsPreview);

    row.querySelector('.opt-label').addEventListener('change', (e) => {
      callbacks.onOptionChange(attrId, index, 'label', e.target.value);
    });
    row.querySelector('.opt-compound').addEventListener('change', (e) => {
      callbacks.onOptionChange(attrId, index, 'compound', e.target.value);
    });
    row.querySelector('.toggle-vis').addEventListener('click', () => {
      callbacks.onToggleOption(attrId, opt.id);
    });
    row.querySelector('.view-products').addEventListener('click', () => {
      const ids = MagentoCore.getProductsForOption(spConfig, attrId, opt.id);
      const show = idsPreview.style.display === 'none';
      idsPreview.style.display = show ? 'block' : 'none';
      idsPreview.textContent = show ? ids.slice(0, 50).join(', ') + (ids.length > 50 ? ` … +${ids.length - 50} more` : '') : '';
    });
    row.querySelector('.remove-opt').addEventListener('click', () => {
      if (confirm(`Remove option "${opt.label}" and ${productCount} linked products from index?`)) {
        callbacks.onRemoveOption(attrId, index);
      }
    });

    return row;
  }

  function renderMatrix(container, state) {
    const spConfig = MagentoCore.getSpConfig(state.data);
    if (!spConfig) {
      container.innerHTML = '';
      return;
    }

    const attrIds = MagentoCore.getSortedAttributeIds(spConfig.attributes);
    if (attrIds.length < 2) {
      container.innerHTML = '<p class="empty-state">Need at least 2 attributes for matrix view</p>';
      return;
    }

    const selA = state.matrixAttrA || attrIds[0];
    const selB = state.matrixAttrB || attrIds[1];

    let html = `
      <div class="matrix-controls">
        <select id="matrixAttrA">${attrIds.map((id) => `<option value="${id}" ${id === selA ? 'selected' : ''}>${esc(spConfig.attributes[id].label)}</option>`).join('')}</select>
        <select id="matrixAttrB">${attrIds.map((id) => `<option value="${id}" ${id === selB ? 'selected' : ''}>${esc(spConfig.attributes[id].label)}</option>`).join('')}</select>
      </div>
    `;

    const matrix = MagentoCore.buildMatrix(spConfig, selA, selB, state.hidden);
    if (!matrix) {
      container.innerHTML = html + '<p>Invalid matrix selection</p>';
      return;
    }

    html += '<div class="matrix-wrap"><table class="matrix-table"><thead><tr><th></th>';
    matrix.optsB.forEach((o) => {
      html += `<th>${esc(o.label)}</th>`;
    });
    html += '</tr></thead><tbody>';

    matrix.optsA.forEach((o1) => {
      html += `<tr><th>${esc(o1.label)}</th>`;
      matrix.optsB.forEach((o2) => {
        const has = matrix.comboMap.has(`${o1.id}:${o2.id}`);
        html += `<td class="${has ? 'yes' : 'no'}">${has ? '✓' : '—'}</td>`;
      });
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;

    container.querySelector('#matrixAttrA').addEventListener('change', (e) => {
      state.matrixAttrA = e.target.value;
      renderMatrix(container, state);
      state.onMatrixChange?.();
    });
    container.querySelector('#matrixAttrB').addEventListener('change', (e) => {
      state.matrixAttrB = e.target.value;
      renderMatrix(container, state);
      state.onMatrixChange?.();
    });
  }

  function renderValidation(container, result) {
    let html = '';
    result.errors.forEach((e) => {
      html += `<div class="val-item error">✕ ${esc(e)}</div>`;
    });
    result.warnings.forEach((w) => {
      html += `<div class="val-item warn">⚠ ${esc(w)}</div>`;
    });
    if (!result.errors.length) {
      html += `<div class="val-item ok">✓ Structure valid (${result.ok.length} attributes)</div>`;
    }
    container.innerHTML = html || '<div class="val-item ok">No issues</div>';
  }

  function renderStats(container, spConfig) {
    const s = MagentoCore.getStats(spConfig);
    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="value">${s.attributes}</div><div class="label">Attributes</div></div>
        <div class="stat-card"><div class="value">${s.options}</div><div class="label">Options</div></div>
        <div class="stat-card"><div class="value">${s.products}</div><div class="label">Products</div></div>
        <div class="stat-card"><div class="value" style="font-size:14px">${esc(s.productId)}</div><div class="label">Config ID</div></div>
      </div>
    `;
  }

  return {
    renderAttributes,
    renderMatrix,
    renderValidation,
    renderStats,
    destroySortables,
  };
})();
