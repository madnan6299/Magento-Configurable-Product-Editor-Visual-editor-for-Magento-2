/**
 * Main application controller.
 */
(function () {
  const state = {
    data: null,
    hidden: new Set(),
    matrixAttrA: null,
    matrixAttrB: null,
    activeTab: 'editor',
    focusAttrId: null,
    onMatrixChange: null,
  };

  const els = {
    jsonInput: document.getElementById('jsonInput'),
    outputJson: document.getElementById('outputJson'),
    editor: document.getElementById('editor'),
    graph: document.getElementById('graph'),
    matrix: document.getElementById('matrix'),
    validation: document.getElementById('validation'),
    stats: document.getElementById('stats'),
    fileInput: document.getElementById('fileInput'),
    toast: document.getElementById('toast'),
  };

  const callbacks = {
    onAttributeReorder(orderedIds) {
      const spConfig = MagentoCore.getSpConfig(state.data);
      MagentoCore.updateAttributePositions(spConfig.attributes, orderedIds);
      refresh();
    },

    onAttributeChange(attrId, field, value) {
      const spConfig = MagentoCore.getSpConfig(state.data);
      spConfig.attributes[attrId][field] = value;
      refresh(false);
    },

    onOptionChange(attrId, index, field, value) {
      const spConfig = MagentoCore.getSpConfig(state.data);
      const opt = spConfig.attributes[attrId].options[index];
      if (field === 'compound') {
        const oldKey = MagentoCore.optionNodeKey(attrId, opt.id);
        const res = MagentoCore.updateOption(spConfig, attrId, opt.id, { compound: value });
        if (res.newNodeId && state.hidden.has(oldKey)) {
          state.hidden.delete(oldKey);
          state.hidden.add(res.newNodeId);
        }
        refresh(false);
        return;
      }
      spConfig.attributes[attrId].options[index][field] = value;
      refresh(false);
    },

    onOptionReorder(attrId, oldIndex, newIndex) {
      const opts = MagentoCore.getSpConfig(state.data).attributes[attrId].options;
      const [moved] = opts.splice(oldIndex, 1);
      opts.splice(newIndex, 0, moved);
      refresh();
    },

    onToggleOption(attrId, optionId) {
      const key = MagentoCore.optionNodeKey(attrId, optionId);
      if (state.hidden.has(key)) state.hidden.delete(key);
      else state.hidden.add(key);
      refresh();
    },

    onAddOption(attrId) {
      const spConfig = MagentoCore.getSpConfig(state.data);
      const newId = String(Date.now()).slice(-6);
      spConfig.attributes[attrId].options.push({
        id: newId,
        label: 'New Option',
        products: [],
      });
      refresh();
    },

    onRemoveOption(attrId, index) {
      const spConfig = MagentoCore.getSpConfig(state.data);
      const opt = spConfig.attributes[attrId].options[index];
      const productIds = MagentoCore.getProductsForOption(spConfig, attrId, opt.id);
      spConfig.attributes[attrId].options.splice(index, 1);
      state.hidden.delete(MagentoCore.optionNodeKey(attrId, opt.id));
      MagentoCore.removeProductsFromIndex(spConfig, productIds);
      refresh();
    },

    onFocusAttributeInGraph(attrId) {
      state.focusAttrId = attrId;
      switchTab('graph');
      refreshGraph();
    },

    onSmartRemoveAttribute(attrId, label, optionCount, productCount) {
      const msg = [
        `Smart Remove "${label}"?`,
        '',
        `• Removes attribute from all ${productCount} index combinations`,
        `• Deletes ${optionCount} options in this attribute`,
        `• Auto-prunes orphan options in other attributes (0 remaining products)`,
        '',
        'This cannot be undone without reloading JSON.',
      ].join('\n');

      if (!confirm(msg)) return;

      const spConfig = MagentoCore.getSpConfig(state.data);
      const report = MagentoCore.removeAttributeSmart(spConfig, attrId);

      [...state.hidden].forEach((key) => {
        if (key.startsWith(`${attrId}:`)) state.hidden.delete(key);
      });

      if (state.matrixAttrA === attrId || state.matrixAttrB === attrId) {
        const attrIds = MagentoCore.getSortedAttributeIds(spConfig.attributes);
        state.matrixAttrA = attrIds[0] ?? null;
        state.matrixAttrB = attrIds[1] ?? null;
      }

      if (state.focusAttrId === attrId) state.focusAttrId = null;
      MagentoGraph.resetSelection();

      refresh();

      const orphanMsg = report.orphansRemoved.length
        ? ` + ${report.orphansRemoved.length} orphan options pruned`
        : '';
      showToast(`Removed "${label}"${orphanMsg}`);
    },
  };

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    setTimeout(() => els.toast.classList.remove('show'), 2800);
  }

  function switchTab(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll('.center-tabs .tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `tab-${tabId}`);
    });
  }

  function initTabs() {
    document.querySelectorAll('.center-tabs .tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
        if (btn.dataset.tab === 'graph') refreshGraph();
      });
    });
  }

  function refreshGraph() {
    if (!els.graph) return;
    MagentoGraph.destroy(els.graph);
    MagentoGraph.render(els.graph, state, (msg) => {
      refresh();
      if (msg) showToast(msg);
    });
  }

  function refresh(reRenderEditor = true) {
    const spConfig = MagentoCore.getSpConfig(state.data);
    if (!spConfig) return;

    MagentoCore.rebuildProductsFromIndex(spConfig);

    if (reRenderEditor) {
      MagentoEditor.renderAttributes(els.editor, state, callbacks);
      MagentoEditor.renderMatrix(els.matrix, state);
      if (state.activeTab === 'graph') refreshGraph();
    }

    MagentoEditor.renderStats(els.stats, spConfig);
    MagentoEditor.renderValidation(els.validation, MagentoCore.validate(state.data, state.hidden));

    const exported = MagentoCore.exportMagentoJson(state.data, state.hidden);
    els.outputJson.value = JSON.stringify(exported, null, 2);
  }

  function loadData(raw) {
    state.data = MagentoCore.parseJson(raw);
    state.hidden.clear();
    state.focusAttrId = null;
    MagentoGraph.resetSelection();
    const attrIds = MagentoCore.getSortedAttributeIds(MagentoCore.getSpConfig(state.data).attributes);
    state.matrixAttrA = attrIds[0] ?? null;
    state.matrixAttrB = attrIds[1] ?? null;
    refresh();
    showToast('Magento JSON loaded successfully');
  }

  window.loadFromTextarea = function () {
    try {
      loadData(els.jsonInput.value);
    } catch (e) {
      alert('Invalid JSON: ' + e.message);
    }
  };

  window.loadSample = async function () {
    try {
      const res = await fetch('magento_sample_json.json');
      if (!res.ok) throw new Error('Sample file not found');
      const text = await res.text();
      els.jsonInput.value = text;
      loadData(text);
    } catch (e) {
      alert('Could not load sample: ' + e.message);
    }
  };

  window.exportJson = function () {
    const blob = new Blob([els.outputJson.value], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'magento_spConfig_export.json';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('JSON exported');
  };

  window.copyOutput = async function () {
    await navigator.clipboard.writeText(els.outputJson.value);
    showToast('Copied to clipboard');
  };

  window.syncIndex = function () {
    const spConfig = MagentoCore.getSpConfig(state.data);
    MagentoCore.rebuildProductsFromIndex(spConfig);
    refresh();
    showToast('Index synced to options.products');
  };

  els.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      els.jsonInput.value = ev.target.result;
      try {
        loadData(ev.target.result);
      } catch (err) {
        alert('Invalid file: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  state.onMatrixChange = () => refresh(false);
  initTabs();
})();
