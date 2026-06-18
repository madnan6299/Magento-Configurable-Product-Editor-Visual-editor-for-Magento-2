/**
 * n8n-style editable relation graph for Magento index option dependencies.
 */
const MagentoGraph = (() => {
  const NODE_W = 168;
  const NODE_H = 58;
  const COL_GAP = 220;
  const ROW_GAP = 14;
  const HEADER_H = 36;
  const PAD = 48;

  let view = { panX: 20, panY: 20, zoom: 1 };
  let dragging = false;
  let dragStart = null;
  let selectedNodeId = null;
  let selectedEdgeId = null;
  let selectedAttrId = null;
  let connectFrom = null;
  let connectLine = null;
  let graphState = null;
  let onMutate = null;

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str ?? '';
    return d.innerHTML;
  }

  function edgeId(from, to) {
    return `${from}|${to}`;
  }

  function parseNodeId(nodeId) {
    const i = nodeId.indexOf(':');
    return { attrId: nodeId.slice(0, i), optionId: nodeId.slice(i + 1) };
  }

  function layoutNodes(graph) {
    const byCol = new Map();
    graph.nodes.forEach((n) => {
      if (!byCol.has(n.column)) byCol.set(n.column, []);
      byCol.get(n.column).push(n);
    });
    byCol.forEach((list) => list.sort((a, b) => a.label.localeCompare(b.label)));

    const positioned = [];
    graph.sortedAttrIds.forEach((attrId, col) => {
      (byCol.get(col) || []).forEach((node, row) => {
        positioned.push({
          ...node,
          x: PAD + col * COL_GAP,
          y: PAD + HEADER_H + row * (NODE_H + ROW_GAP),
        });
      });
    });
    return positioned;
  }

  function bezierPath(x1, y1, x2, y2) {
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  }

  function maxWeight(edges) {
    return Math.max(1, ...edges.map((e) => e.weight));
  }

  function cssEscape(id) {
    return id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function mutate(_container, _state, msg) {
    onMutate?.(msg);
  }

  function render(container, state, mutateCb) {
    graphState = state;
    onMutate = mutateCb;
    const spConfig = MagentoCore.getSpConfig(state.data);

    if (!spConfig) {
      container.innerHTML = '<div class="empty-state"><p>Load JSON to view relation graph</p></div>';
      return;
    }

    const graph = MagentoCore.buildRelationGraph(spConfig, state.hidden);
    if (!graph.nodes.length && !Object.keys(graph.attributes).length) {
      container.innerHTML = '<div class="empty-state"><p>No attributes to graph</p></div>';
      return;
    }

    const positioned = layoutNodes(graph);
    const nodeMap = new Map(positioned.map((n) => [n.id, n]));
    const maxW = maxWeight(graph.edges.length ? graph.edges : [{ weight: 1 }]);

    const cols = graph.sortedAttrIds.length;
    const maxRows = Math.max(
      1,
      ...graph.sortedAttrIds.map((_, col) => positioned.filter((n) => n.column === col).length)
    );
    const canvasW = PAD * 2 + Math.max(0, cols - 1) * COL_GAP + NODE_W;
    const canvasH = PAD * 2 + HEADER_H + maxRows * (NODE_H + ROW_GAP) + 40;

    const related = selectedNodeId
      ? MagentoCore.getRelatedNodeIds(spConfig, selectedNodeId, state.hidden)
      : null;
    const downstream = selectedNodeId
      ? MagentoCore.getDownstreamOptions(spConfig, selectedNodeId, state.hidden)
      : null;

    container.innerHTML = `
      <div class="graph-toolbar">
        <span class="graph-hint">
          <strong>Edit mode:</strong> drag output port → input port to add relation · click edge to edit · use inspector panel →
        </span>
        <div class="graph-toolbar-actions">
          <button type="button" class="secondary graph-reset-view">Reset View</button>
          <button type="button" class="secondary graph-clear-sel">Clear</button>
        </div>
      </div>
      <div class="graph-workspace">
        <div class="graph-viewport" id="graphViewport">
          <svg class="graph-svg" id="graphSvg" width="100%" height="100%">
            <defs>
              <pattern id="dotGrid" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="#2d3f56"/>
              </pattern>
              <marker id="arrowHead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#5b8def"/>
              </marker>
              <marker id="arrowHeadSel" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#f59e0b"/>
              </marker>
            </defs>
            <g class="graph-world" transform="translate(${view.panX},${view.panY}) scale(${view.zoom})">
              <rect class="graph-bg" x="0" y="0" width="${canvasW}" height="${canvasH}" fill="url(#dotGrid)"/>
              ${renderColumnHeaders(graph, positioned, selectedAttrId)}
              <g class="graph-edges">${renderEdges(graph.edges, nodeMap, maxW, related, selectedEdgeId)}</g>
              <g class="graph-connect-layer"></g>
              ${renderNodes(positioned, related, selectedNodeId)}
            </g>
          </svg>
        </div>
        <aside class="graph-inspector" id="graphInspector">
          ${renderInspector(spConfig, graph, state, selectedNodeId, selectedEdgeId, selectedAttrId, downstream)}
        </aside>
      </div>
    `;

    bindEvents(container, state, graph, positioned, nodeMap);
  }

  function renderInspector(spConfig, graph, state, nodeId, edgeKey, attrId, downstream) {
    if (edgeKey) {
      const [from, to] = edgeKey.split('|');
      const weight = MagentoCore.getProductsForEdge(spConfig, from, to).length;
      const fromN = graph.nodes.find((n) => n.id === from);
      const toN = graph.nodes.find((n) => n.id === to);
      return `
        <h3>Relation</h3>
        <div class="insp-section">
          <div class="insp-row"><label>From</label><div>${esc(fromN?.label || from)}</div></div>
          <div class="insp-row"><label>To</label><div>${esc(toN?.label || to)}</div></div>
          <div class="insp-row"><label>Combinations</label><div><strong>${weight}</strong> products in index</div></div>
        </div>
        <div class="insp-actions">
          <button type="button" class="danger" data-action="delete-edge" data-from="${esc(from)}" data-to="${esc(to)}">Delete Relation</button>
        </div>
        <p class="insp-note">Removes all index products matching this option pair.</p>
      `;
    }

    if (nodeId) {
      const { attrId: aId, optionId } = parseNodeId(nodeId);
      const attr = spConfig.attributes[aId];
      const opt = (attr?.options ?? []).find((o) => String(o.id) === optionId);
      const count = MagentoCore.getProductsForOption(spConfig, aId, optionId).length;
      const isHidden = state.hidden.has(nodeId);

      const outEdges = graph.edges.filter((e) => e.from === nodeId);
      const inEdges = graph.edges.filter((e) => e.to === nodeId);

      return `
        <h3>Option Node</h3>
        <div class="insp-section">
          <div class="insp-row"><label>Attribute</label><div>${esc(attr?.label)} <small>(${esc(aId)})</small></div></div>
          <div class="insp-row">
            <label>Label</label>
            <input type="text" id="inspOptLabel" value="${esc(opt?.label || '')}">
          </div>
          <div class="insp-row">
            <label>Option</label>
            <input type="text" id="inspOptCompound" value="${esc(MagentoCore.formatOptionCompound(opt))}" placeholder="114 | 6.48 | extra">
          </div>
          <div class="insp-row"><label>Pure ID</label><div><code>${esc(MagentoCore.getPureOptionId(opt))}</code> <small class="muted">used in index</small></div></div>
          <div class="insp-row"><label>Products</label><div>${count} combinations</div></div>
          <div class="insp-row"><label>Status</label><div>${isHidden ? '<span class="tag-warn">Hidden</span>' : '<span class="tag-ok">Visible</span>'}</div></div>
        </div>
        <div class="insp-actions">
          <button type="button" data-action="save-node" data-node="${esc(nodeId)}">Save Changes</button>
          <button type="button" class="secondary" data-action="toggle-node" data-node="${esc(nodeId)}">${isHidden ? 'Show' : 'Hide'}</button>
          <button type="button" class="danger" data-action="delete-node" data-node="${esc(nodeId)}">Delete Option</button>
        </div>
        <h4>Outgoing (${outEdges.length})</h4>
        <div class="insp-edge-list">
          ${outEdges.length ? outEdges.map((e) => {
            const toN = graph.nodes.find((n) => n.id === e.to);
            return `<div class="insp-edge-item">
              <span>→ ${esc(toN?.label || e.to)} <em>(${e.weight})</em></span>
              <button type="button" class="danger" data-action="delete-edge" data-from="${esc(e.from)}" data-to="${esc(e.to)}">✕</button>
            </div>`;
          }).join('') : '<div class="muted">Drag from right port to connect →</div>'}
        </div>
        <h4>Incoming (${inEdges.length})</h4>
        <div class="insp-edge-list">
          ${inEdges.length ? inEdges.map((e) => {
            const fromN = graph.nodes.find((n) => n.id === e.from);
            return `<div class="insp-edge-item">
              <span>← ${esc(fromN?.label || e.from)} <em>(${e.weight})</em></span>
              <button type="button" class="danger" data-action="delete-edge" data-from="${esc(e.from)}" data-to="${esc(e.to)}">✕</button>
            </div>`;
          }).join('') : '<div class="muted">No incoming relations</div>'}
        </div>
        ${downstream?.size ? `<h4>Enables downstream</h4><div class="insp-note">${buildDownstreamText(spConfig, downstream)}</div>` : ''}
      `;
    }

    if (attrId) {
      const attr = spConfig.attributes[attrId];
      const optCount = (attr?.options ?? []).length;
      return `
        <h3>Attribute Column</h3>
        <div class="insp-section">
          <div class="insp-row">
            <label>Label</label>
            <input type="text" id="inspAttrLabel" value="${esc(attr?.label || '')}">
          </div>
          <div class="insp-row">
            <label>Code</label>
            <input type="text" id="inspAttrCode" value="${esc(attr?.code || '')}">
          </div>
          <div class="insp-row"><label>Options</label><div>${optCount}</div></div>
        </div>
        <div class="insp-actions">
          <button type="button" data-action="save-attr" data-attr="${esc(attrId)}">Save Attribute</button>
          <button type="button" class="secondary" data-action="add-option" data-attr="${esc(attrId)}">+ Add Option</button>
        </div>
        <p class="insp-note">Click column header to select · Add options or edit attribute metadata here.</p>
      `;
    }

    return `
      <h3>Graph Editor</h3>
      <p class="insp-note">Select a <strong>node</strong>, <strong>edge</strong>, or <strong>column header</strong> to edit.</p>
      <ul class="insp-help">
        <li>Drag <span class="port-dot out"></span> output port to <span class="port-dot in"></span> input port to add relation</li>
        <li>Click edge to edit/delete relation</li>
        <li>Click node to edit label, ID, hide or delete</li>
        <li>Click column header to add options</li>
      </ul>
    `;
  }

  function buildDownstreamText(spConfig, downstream) {
    const parts = [];
    downstream.forEach((optSet, aId) => {
      const a = spConfig.attributes[aId];
      const labels = [...optSet].map((oid) => {
        const o = (a?.options ?? []).find((x) => String(x.id) === oid);
        return o?.label || oid;
      });
      parts.push(`${a?.label}: ${labels.join(', ')}`);
    });
    return esc(parts.join(' · '));
  }

  function renderColumnHeaders(graph, positioned, selectedAttrId) {
    return graph.sortedAttrIds
      .map((attrId, col) => {
        const attr = graph.attributes[attrId];
        const colNodes = positioned.filter((n) => n.column === col);
        const x = colNodes[0]?.x ?? PAD + col * COL_GAP;
        const selected = selectedAttrId === attrId ? ' selected-col' : '';
        return `
          <g class="graph-column-header${selected}" data-attr-id="${esc(attrId)}" transform="translate(${x}, ${PAD})">
            <rect width="${NODE_W}" height="${HEADER_H - 2}" rx="8" class="col-header-bg"/>
            <text x="${NODE_W / 2}" y="15" text-anchor="middle" class="col-header-title">${esc(attr.label)}</text>
            <text x="${NODE_W / 2}" y="27" text-anchor="middle" class="col-header-sub">${colNodes.length} opts · click to edit</text>
            <g class="col-add-btn" transform="translate(${NODE_W - 22}, 4)">
              <circle r="9" cx="9" cy="9" class="col-add-circle"/>
              <text x="9" y="13" text-anchor="middle" class="col-add-text">+</text>
            </g>
          </g>
        `;
      })
      .join('');
  }

  function renderEdges(edges, nodeMap, maxW, related, selectedEdgeId) {
    return edges
      .map((edge) => {
        const from = nodeMap.get(edge.from);
        const to = nodeMap.get(edge.to);
        if (!from || !to) return '';

        const eid = edgeId(edge.from, edge.to);
        const isSel = selectedEdgeId === eid;
        const active = isSel || !related || (related.has(edge.from) && related.has(edge.to));
        const opacity = active ? 0.4 + (edge.weight / maxW) * 0.55 : 0.05;
        const strokeW = isSel ? 3 : active ? 1 + (edge.weight / maxW) * 2.5 : 0.5;

        const x1 = from.x + NODE_W;
        const y1 = from.y + NODE_H / 2;
        const x2 = to.x;
        const y2 = to.y + NODE_H / 2;

        return `
          <path
            class="graph-edge ${isSel ? 'selected-edge' : active ? 'active' : 'dim'}"
            data-edge-id="${esc(eid)}"
            data-from="${esc(edge.from)}"
            data-to="${esc(edge.to)}"
            d="${bezierPath(x1, y1, x2, y2)}"
            stroke-width="${strokeW}"
            stroke-opacity="${opacity}"
            marker-end="${active ? (isSel ? 'url(#arrowHeadSel)' : 'url(#arrowHead)') : ''}"
          />
        `;
      })
      .join('');
  }

  function renderNodes(positioned, related, selectedNodeId) {
    return positioned
      .map((node) => {
        const active = !related || related.has(node.id);
        const isSelected = node.id === selectedNodeId;
        const isDownstream = related && related.has(node.id) && node.id !== selectedNodeId;

        let cls = 'graph-node';
        if (!active) cls += ' dim';
        if (isSelected) cls += ' selected';
        if (isDownstream) cls += ' downstream';

        return `
          <g class="${cls}" data-node-id="${cssEscape(node.id)}" transform="translate(${node.x}, ${node.y})">
            <rect class="node-body" width="${NODE_W}" height="${NODE_H}" rx="10"/>
            <circle class="node-port node-port-in" data-port="in" data-node="${cssEscape(node.id)}" cx="0" cy="${NODE_H / 2}" r="6"/>
            <circle class="node-port node-port-out" data-port="out" data-node="${cssEscape(node.id)}" cx="${NODE_W}" cy="${NODE_H / 2}" r="6"/>
            <text x="12" y="20" class="node-attr">${esc(node.attrLabel)}</text>
            <text x="12" y="34" class="node-label">${esc(truncate(node.label, 18))}</text>
            <text x="12" y="46" class="node-compound">${esc(truncate(node.compound || node.optionId, 20))}</text>
            <text x="${NODE_W - 10}" y="38" text-anchor="end" class="node-count">${node.productCount}</text>
          </g>
        `;
      })
      .join('');
  }

  function truncate(str, len) {
    if (!str || str.length <= len) return str;
    return `${str.slice(0, len - 1)}…`;
  }

  function bindEvents(container, state, graph, positioned, nodeMap) {
    const viewport = container.querySelector('#graphViewport');
    const svg = container.querySelector('#graphSvg');
    const world = svg.querySelector('.graph-world');
    const connectLayer = svg.querySelector('.graph-connect-layer');
    const inspector = container.querySelector('#graphInspector');
    const spConfig = MagentoCore.getSpConfig(state.data);

    container.querySelector('.graph-reset-view')?.addEventListener('click', () => {
      view = { panX: 20, panY: 20, zoom: 1 };
      render(container, state, onMutate);
    });

    container.querySelector('.graph-clear-sel')?.addEventListener('click', () => {
      selectedNodeId = null;
      selectedEdgeId = null;
      selectedAttrId = null;
      render(container, state, onMutate);
    });

    positioned.forEach((node) => {
      const el = container.querySelector(`[data-node-id="${cssEscape(node.id)}"]`);
      if (!el) return;

      el.querySelector('.node-body')?.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedNodeId = node.id;
        selectedEdgeId = null;
        selectedAttrId = null;
        render(container, state, onMutate);
      });

      const outPort = el.querySelector('[data-port="out"]');
      const inPort = el.querySelector('[data-port="in"]');

      outPort?.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        connectFrom = { nodeId: node.id, x: node.x + NODE_W, y: node.y + NODE_H / 2 };
        connectLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        connectLine.setAttribute('class', 'graph-connect-temp');
        connectLayer.appendChild(connectLine);
        viewport.classList.add('connecting');
      });

      inPort?.addEventListener('mouseup', (e) => {
        if (!connectFrom) return;
        e.stopPropagation();
        finishConnect(container, state, connectFrom.nodeId, node.id);
      });
    });

    svg.querySelectorAll('.graph-edge').forEach((path) => {
      path.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedEdgeId = path.dataset.edgeId;
        selectedNodeId = null;
        selectedAttrId = null;
        render(container, state, onMutate);
      });
    });

    svg.querySelectorAll('.graph-column-header').forEach((hdr) => {
      hdr.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target.closest('.col-add-btn')) return;
        selectedAttrId = hdr.dataset.attrId;
        selectedNodeId = null;
        selectedEdgeId = null;
        render(container, state, onMutate);
      });
      hdr.querySelector('.col-add-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const attrId = hdr.dataset.attrId;
        const label = prompt('New option label:', 'New Option');
        if (!label) return;
        const res = MagentoCore.addOptionToAttribute(spConfig, attrId, label);
        if (res.error) return alert(res.error);
        selectedAttrId = attrId;
        selectedNodeId = res.nodeId;
        mutate(container, state, `Added option "${label}"`);
      });
    });

    inspector?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;

      if (action === 'save-node') {
        const nodeId = btn.dataset.node;
        const { attrId, optionId } = parseNodeId(nodeId);
        const label = inspector.querySelector('#inspOptLabel')?.value;
        const compound = inspector.querySelector('#inspOptCompound')?.value;
        const res = MagentoCore.updateOption(spConfig, attrId, optionId, { label, compound });
        if (res.error) return alert(res.error);
        if (res.newNodeId !== nodeId && state.hidden.has(nodeId)) {
          state.hidden.delete(nodeId);
          state.hidden.add(res.newNodeId);
        }
        selectedNodeId = res.newNodeId;
        mutate(container, state, 'Option updated');
        return;
      }

      if (action === 'toggle-node') {
        const key = btn.dataset.node;
        if (state.hidden.has(key)) state.hidden.delete(key);
        else state.hidden.add(key);
        mutate(container, state, 'Option visibility toggled');
        return;
      }

      if (action === 'delete-node') {
        const nodeId = btn.dataset.node;
        const { attrId, optionId } = parseNodeId(nodeId);
        const opt = MagentoCore.findOption(spConfig, attrId, optionId);
        if (!confirm(`Delete option "${opt?.label}" and prune combinations?`)) return;
        const res = MagentoCore.removeOptionSmart(spConfig, attrId, optionId);
        if (res.error) return alert(res.error);
        state.hidden.delete(nodeId);
        selectedNodeId = null;
        mutate(container, state, `Deleted option (${res.removedProducts} products removed)`);
        return;
      }

      if (action === 'delete-edge') {
        const from = btn.dataset.from;
        const to = btn.dataset.to;
        const count = MagentoCore.getProductsForEdge(spConfig, from, to).length;
        if (!confirm(`Delete relation (${count} combinations)?`)) return;
        const res = MagentoCore.removeRelation(spConfig, from, to);
        selectedEdgeId = null;
        mutate(container, state, `Relation removed (${res.removed} products)`);
        return;
      }

      if (action === 'save-attr') {
        const attrId = btn.dataset.attr;
        const label = inspector.querySelector('#inspAttrLabel')?.value;
        const code = inspector.querySelector('#inspAttrCode')?.value;
        MagentoCore.updateAttributeMeta(spConfig, attrId, { label, code });
        mutate(container, state, 'Attribute updated');
        return;
      }

      if (action === 'add-option') {
        const attrId = btn.dataset.attr;
        const label = prompt('New option label:', 'New Option');
        if (!label) return;
        const res = MagentoCore.addOptionToAttribute(spConfig, attrId, label);
        if (res.error) return alert(res.error);
        selectedNodeId = res.nodeId;
        mutate(container, state, `Added option "${label}"`);
      }
    });

    function onConnectMove(e) {
      if (!connectFrom || !connectLine) return;
      const pt = svgPoint(svg, e.clientX, e.clientY);
      connectLine.setAttribute('d', bezierPath(connectFrom.x, connectFrom.y, pt.x, pt.y));
    }

    function onConnectUp(e) {
      if (!connectFrom) return;
      const target = e.target.closest('[data-port="in"]');
      if (target) {
        finishConnect(container, state, connectFrom.nodeId, target.dataset.node);
      } else {
        cleanupConnect();
        viewport.classList.remove('connecting');
      }
    }

    window.addEventListener('mousemove', onConnectMove);
    window.addEventListener('mouseup', onConnectUp);

    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.92 : 1.08;
      view.zoom = Math.min(2.5, Math.max(0.35, view.zoom * delta));
      world.setAttribute('transform', `translate(${view.panX},${view.panY}) scale(${view.zoom})`);
    }, { passive: false });

    viewport.addEventListener('mousedown', (e) => {
      if (e.target.closest('.graph-node') || e.target.closest('.graph-column-header')) return;
      if (connectFrom) return;
      dragging = true;
      dragStart = { x: e.clientX - view.panX, y: e.clientY - view.panY };
      viewport.classList.add('grabbing');
    });

    function onPanMove(e) {
      if (!dragging || !dragStart) return;
      view.panX = e.clientX - dragStart.x;
      view.panY = e.clientY - dragStart.y;
      world.setAttribute('transform', `translate(${view.panX},${view.panY}) scale(${view.zoom})`);
    }

    function onPanUp() {
      dragging = false;
      dragStart = null;
      viewport.classList.remove('grabbing');
    }

    window.addEventListener('mousemove', onPanMove);
    window.addEventListener('mouseup', onPanUp);

    container._graphCleanup = () => {
      window.removeEventListener('mousemove', onConnectMove);
      window.removeEventListener('mouseup', onConnectUp);
      window.removeEventListener('mousemove', onPanMove);
      window.removeEventListener('mouseup', onPanUp);
    };
  }

  function finishConnect(container, state, fromId, toId) {
    cleanupConnect();
    container.querySelector('#graphViewport')?.classList.remove('connecting');

    if (fromId === toId) return;

    const spConfig = MagentoCore.getSpConfig(state.data);
    const res = MagentoCore.addRelation(spConfig, fromId, toId);
    if (res.error) {
      alert(res.error);
      return;
    }
    selectedNodeId = fromId;
    selectedEdgeId = edgeId(fromId, toId);
    selectedAttrId = null;
    mutate(container, state, res.created ? `Relation added (${res.created} new combinations)` : 'Relation already exists');
  }

  function cleanupConnect() {
    connectFrom = null;
    if (connectLine?.parentNode) connectLine.parentNode.removeChild(connectLine);
    connectLine = null;
  }

  function svgPoint(svg, clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.querySelector('.graph-world').getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  function resetSelection() {
    selectedNodeId = null;
    selectedEdgeId = null;
    selectedAttrId = null;
    connectFrom = null;
    view = { panX: 20, panY: 20, zoom: 1 };
  }

  function destroy(container) {
    cleanupConnect();
    if (container?._graphCleanup) container._graphCleanup();
  }

  return { render, resetSelection, destroy };
})();
