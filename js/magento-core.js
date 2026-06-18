/**
 * Magento 2 configurable product spConfig utilities.
 * Works with JSON from x-magento-init / #product_addtocart_form structure.
 */
const MagentoCore = (() => {
  const ROOT_KEY = '#product_addtocart_form';

  function getSpConfig(data) {
    return data?.[ROOT_KEY]?.configurable?.spConfig ?? null;
  }

  function setSpConfig(data, spConfig) {
    if (!data[ROOT_KEY]) data[ROOT_KEY] = { configurable: {} };
    if (!data[ROOT_KEY].configurable) data[ROOT_KEY].configurable = {};
    data[ROOT_KEY].configurable.spConfig = spConfig;
    return data;
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /** Parse compound option id: "114 | 6.48 | extra meta" */
  function parseOptionCompound(input) {
    const str = String(input ?? '').trim();
    if (!str.includes('|')) {
      return { id: str, value: null, extra: null };
    }
    const parts = str.split('|').map((p) => p.trim());
    const id = parts[0];
    const valueRaw = parts[1] ?? '';
    let value = null;
    if (valueRaw !== '') {
      const num = parseFloat(valueRaw);
      value = Number.isNaN(num) ? valueRaw : num;
    }
    const extra = parts.length > 2 ? parts.slice(2).join(' | ') : null;
    return { id, value, extra };
  }

  function getPureOptionId(optOrId) {
    if (optOrId == null) return '';
    if (typeof optOrId === 'object') return parseOptionCompound(optOrId.id).id;
    return parseOptionCompound(optOrId).id;
  }

  function formatOptionCompound(opt) {
    const id = getPureOptionId(opt);
    const val = opt?.optionValue ?? opt?.value;
    if (val == null || val === '') return String(id);
    let out = `${id} | ${val}`;
    const meta = opt?.optionMeta ?? opt?.extra;
    if (meta) out += ` | ${meta}`;
    return out;
  }

  function normalizeOption(opt) {
    const parsed = parseOptionCompound(opt.id);
    opt.id = parsed.id;
    if (parsed.value != null && opt.optionValue == null) opt.optionValue = parsed.value;
    if (parsed.extra && !opt.optionMeta) opt.optionMeta = parsed.extra;
    if (opt.value != null && opt.optionValue == null) opt.optionValue = opt.value;
    if (opt.extra != null && !opt.optionMeta) opt.optionMeta = opt.extra;
    return opt;
  }

  function inferOptionValue(spConfig, optionId) {
    const pure = getPureOptionId(optionId);
    const op = spConfig?.optionPrices;
    if (!op) return null;
    if (Array.isArray(op)) {
      const entry = op.find(
        (e) => String(e?.optionId ?? e?.id) === pure
      );
      return entry?.prices?.finalPrice?.amount ?? entry?.price ?? null;
    }
    const entry = op[pure];
    if (!entry) return null;
    return entry?.finalPrice?.amount ?? entry?.amount ?? entry;
  }

  function normalizeSpConfigOptions(spConfig) {
    Object.values(spConfig.attributes ?? {}).forEach((attr) => {
      (attr.options ?? []).forEach((opt) => {
        normalizeOption(opt);
        if (opt.optionValue == null) {
          const inferred = inferOptionValue(spConfig, opt.id);
          if (inferred != null) opt.optionValue = inferred;
        }
      });
    });
    return spConfig;
  }

  function applyCompoundToOption(opt, compoundStr) {
    const parsed = parseOptionCompound(compoundStr);
    opt.id = parsed.id;
    opt.optionValue = parsed.value;
    opt.optionMeta = parsed.extra;
    return opt;
  }

  function optionNodeKey(attrId, optionId) {
    return `${attrId}:${getPureOptionId(optionId)}`;
  }

  function getSortedAttributeIds(attributes) {
    return Object.keys(attributes).sort((a, b) => {
      const pa = parseInt(attributes[a].position ?? 0, 10);
      const pb = parseInt(attributes[b].position ?? 0, 10);
      return pa - pb || a.localeCompare(b);
    });
  }

  function getStats(spConfig) {
    const attributes = spConfig?.attributes ?? {};
    const index = spConfig?.index ?? {};
    const attrIds = Object.keys(attributes);
    let optionCount = 0;

    attrIds.forEach((id) => {
      optionCount += (attributes[id].options ?? []).length;
    });

    return {
      attributes: attrIds.length,
      options: optionCount,
      products: Object.keys(index).length,
      productId: spConfig?.productId ?? '-',
    };
  }

  function rebuildProductsFromIndex(spConfig) {
    const attributes = spConfig.attributes ?? {};
    const index = spConfig.index ?? {};

    Object.keys(attributes).forEach((attrId) => {
      (attributes[attrId].options ?? []).forEach((opt) => {
        opt.products = [];
      });
    });

    Object.entries(index).forEach(([productId, combo]) => {
      Object.entries(combo).forEach(([attrId, optionId]) => {
        const attr = attributes[attrId];
        if (!attr) return;
        const opt = (attr.options ?? []).find(
          (o) => getPureOptionId(o.id) === getPureOptionId(optionId)
        );
        if (opt) {
          if (!opt.products) opt.products = [];
          if (!opt.products.includes(productId)) opt.products.push(productId);
        }
      });
    });

    return spConfig;
  }

  function removeProductsFromIndex(spConfig, productIds) {
    const ids = new Set(productIds.map(String));
    const index = spConfig.index ?? {};
    Object.keys(index).forEach((pid) => {
      if (ids.has(String(pid))) delete index[pid];
    });
    rebuildProductsFromIndex(spConfig);
    return spConfig;
  }

  function getProductsForOption(spConfig, attrId, optionId) {
    const index = spConfig.index ?? {};
    const matches = [];
    Object.entries(index).forEach(([productId, combo]) => {
      if (String(combo[attrId]) === getPureOptionId(optionId)) matches.push(productId);
    });
    return matches;
  }

  function applyHiddenOptions(spConfig, hiddenSet) {
    const clone = deepClone(spConfig);
    const attributes = clone.attributes ?? {};
    const index = clone.index ?? {};

    Object.keys(attributes).forEach((attrId) => {
      const attr = attributes[attrId];
      attr.options = (attr.options ?? []).filter((opt) => {
        const key = optionNodeKey(attrId, opt.id);
        return !hiddenSet.has(key);
      });
    });

    Object.keys(index).forEach((productId) => {
      const combo = index[productId];
      const usesHidden = Object.entries(combo).some(([attrId, optionId]) =>
        hiddenSet.has(optionNodeKey(attrId, optionId))
      );
      if (usesHidden) delete index[productId];
    });

    rebuildProductsFromIndex(clone);
    return clone;
  }

  function updateAttributePositions(attributes, orderedIds) {
    orderedIds.forEach((id, i) => {
      if (attributes[id]) attributes[id].position = String(i);
    });
    return attributes;
  }

  function validate(data, hiddenSet = new Set()) {
    const errors = [];
    const warnings = [];
    const ok = [];

    if (!data?.[ROOT_KEY]) {
      errors.push('Missing root key: #product_addtocart_form');
      return { errors, warnings, ok };
    }

    const spConfig = getSpConfig(data);
    if (!spConfig) {
      errors.push('Missing configurable.spConfig');
      return { errors, warnings, ok };
    }

    const attributes = spConfig.attributes ?? {};
    const index = spConfig.index ?? {};
    const attrIds = Object.keys(attributes);

    if (!attrIds.length) errors.push('No attributes found in spConfig');

    attrIds.forEach((attrId) => {
      const attr = attributes[attrId];
      if (!attr.label) errors.push(`Attribute ${attrId} missing label`);
      if (!attr.code) warnings.push(`Attribute ${attrId} missing code`);
      if (!attr.options?.length) {
        errors.push(`Attribute "${attr.label || attrId}" has no options`);
      } else {
        ok.push(`Attribute: ${attr.label} (${attr.options.length} options)`);
      }

      (attr.options ?? []).forEach((opt) => {
        const key = optionNodeKey(attrId, opt.id);
        if (hiddenSet.has(key)) return;
        if (!opt.id) warnings.push(`Option "${opt.label}" in ${attr.label} missing id`);
        const indexed = getProductsForOption(spConfig, attrId, opt.id);
        const listed = opt.products ?? [];
        if (indexed.length !== listed.length) {
          warnings.push(
            `Option "${opt.label}" (${attr.label}): index has ${indexed.length} products, options.products has ${listed.length}`
          );
        }
      });
    });

    Object.entries(index).forEach(([productId, combo]) => {
      const usesHidden = Object.entries(combo).some(([attrId, optionId]) =>
        hiddenSet.has(optionNodeKey(attrId, optionId))
      );
      if (usesHidden) return;

      Object.entries(combo).forEach(([attrId, optionId]) => {
        if (!attributes[attrId]) {
          errors.push(`Product ${productId} references unknown attribute ${attrId}`);
          return;
        }
        const opt = (attributes[attrId].options ?? []).find(
          (o) => getPureOptionId(o.id) === getPureOptionId(optionId)
        );
        if (!opt) {
          errors.push(
            `Product ${productId}: option ${optionId} not found in attribute ${attributes[attrId].label}`
          );
        } else if (hiddenSet.has(optionNodeKey(attrId, optionId))) {
          warnings.push(`Product ${productId} uses hidden option ${opt.label}`);
        }
      });
    });

    if (!spConfig.productId) warnings.push('Missing productId in spConfig');
    if (!spConfig.chooseText) warnings.push('Missing chooseText in spConfig');

    return { errors, warnings, ok };
  }

  function buildMatrix(spConfig, attrIdA, attrIdB, hiddenSet = new Set()) {
    const attributes = spConfig.attributes ?? {};
    const index = spConfig.index ?? {};
    const a = attributes[attrIdA];
    const b = attributes[attrIdB];
    if (!a || !b) return null;

    const visibleOpts = (attrId, opts) =>
      (opts ?? []).filter((o) => !hiddenSet.has(optionNodeKey(attrId, o.id)));

    const optsA = visibleOpts(attrIdA, a.options);
    const optsB = visibleOpts(attrIdB, b.options);

    const comboMap = new Map();
    Object.entries(index).forEach(([productId, combo]) => {
      const oa = combo[attrIdA];
      const ob = combo[attrIdB];
      if (!oa || !ob) return;
      if (hiddenSet.has(`${attrIdA}:${oa}`) || hiddenSet.has(`${attrIdB}:${ob}`)) return;
      comboMap.set(`${oa}:${ob}`, productId);
    });

    return { a, b, optsA, optsB, comboMap };
  }

  function exportMagentoJson(sourceData, hiddenSet = new Set()) {
    const data = deepClone(sourceData);
    const spConfig = getSpConfig(data);
    if (!spConfig) return data;

    const cleaned = applyHiddenOptions(spConfig, hiddenSet);
    rebuildProductsFromIndex(cleaned);
    setSpConfig(data, cleaned);
    return data;
  }

  function parseJson(text) {
    const data = JSON.parse(text);
    const spConfig = getSpConfig(data);
    if (!spConfig) {
      throw new Error('Invalid Magento JSON: missing #product_addtocart_form.configurable.spConfig');
    }
    rebuildProductsFromIndex(spConfig);
    normalizeSpConfigOptions(spConfig);
    return data;
  }

  /** Build n8n-style relation graph from index combinations. */
  function buildRelationGraph(spConfig, hiddenSet = new Set()) {
    const attributes = spConfig.attributes ?? {};
    const index = spConfig.index ?? {};
    const sortedAttrIds = getSortedAttributeIds(attributes);
    const nodes = [];
    const edgeMap = new Map();

    sortedAttrIds.forEach((attrId, column) => {
      const attr = attributes[attrId];
      (attr.options ?? []).forEach((opt) => {
        const pureId = getPureOptionId(opt.id);
        const id = optionNodeKey(attrId, pureId);
        if (hiddenSet.has(id)) return;
        nodes.push({
          id,
          attrId,
          optionId: pureId,
          label: opt.label,
          compound: formatOptionCompound(opt),
          optionValue: opt.optionValue,
          optionMeta: opt.optionMeta,
          attrLabel: attr.label,
          column,
          productCount: getProductsForOption(spConfig, attrId, pureId).length,
        });
      });
    });

    for (let c = 0; c < sortedAttrIds.length - 1; c += 1) {
      const attrA = sortedAttrIds[c];
      const attrB = sortedAttrIds[c + 1];

      Object.values(index).forEach((combo) => {
        const optA = combo[attrA];
        const optB = combo[attrB];
        if (!optA || !optB) return;
        const from = `${attrA}:${optA}`;
        const to = `${attrB}:${optB}`;
        if (hiddenSet.has(from) || hiddenSet.has(to)) return;
        const key = `${from}|${to}`;
        edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
      });
    }

    const edges = [...edgeMap.entries()].map(([key, weight]) => {
      const [from, to] = key.split('|');
      return { from, to, weight };
    });

    return { nodes, edges, sortedAttrIds, attributes };
  }

  /** All co-occurring options for products containing the given option. */
  function getRelatedNodeIds(spConfig, nodeId, hiddenSet = new Set()) {
    const [attrId, optionId] = nodeId.split(':');
    const related = new Set([nodeId]);
    const productIds = getProductsForOption(spConfig, attrId, optionId);

    productIds.forEach((pid) => {
      const combo = spConfig.index?.[pid];
      if (!combo) return;
      Object.entries(combo).forEach(([aId, oId]) => {
        const key = `${aId}:${oId}`;
        if (!hiddenSet.has(key)) related.add(key);
      });
    });

    return related;
  }

  /** Downstream options reachable from a source option (later attributes only). */
  function getDownstreamOptions(spConfig, nodeId, hiddenSet = new Set()) {
    const related = getRelatedNodeIds(spConfig, nodeId, hiddenSet);
    const [srcAttrId] = nodeId.split(':');
    const sorted = getSortedAttributeIds(spConfig.attributes ?? {});
    const srcCol = sorted.indexOf(srcAttrId);
    const downstream = new Map();

    related.forEach((id) => {
      const [attrId, optionId] = id.split(':');
      const col = sorted.indexOf(attrId);
      if (col <= srcCol) return;
      if (!downstream.has(attrId)) downstream.set(attrId, new Set());
      downstream.get(attrId).add(optionId);
    });

    return downstream;
  }

  function generateOptionId() {
    return `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  }

  function generateProductId(spConfig) {
    const ids = Object.keys(spConfig.index ?? {})
      .map((id) => parseInt(id, 10))
      .filter((n) => !Number.isNaN(n));
    return String((ids.length ? Math.max(...ids) : 1800) + 1);
  }

  function comboKey(combo) {
    return JSON.stringify(
      Object.keys(combo)
        .sort()
        .reduce((acc, k) => {
          acc[k] = String(combo[k]);
          return acc;
        }, {})
    );
  }

  function findOption(spConfig, attrId, optionId) {
    const pure = getPureOptionId(optionId);
    return (spConfig.attributes?.[attrId]?.options ?? []).find(
      (o) => getPureOptionId(o.id) === pure
    );
  }

  function getProductsForEdge(spConfig, fromNodeId, toNodeId) {
    const [attrA, optA] = fromNodeId.split(':');
    const [attrB, optB] = toNodeId.split(':');
    const matches = [];
    Object.entries(spConfig.index ?? {}).forEach(([pid, combo]) => {
      if (String(combo[attrA]) === String(optA) && String(combo[attrB]) === String(optB)) {
        matches.push(pid);
      }
    });
    return matches;
  }

  function buildDefaultCombo(spConfig, overrides = {}) {
    const combo = {};
    getSortedAttributeIds(spConfig.attributes ?? {}).forEach((attrId) => {
      if (overrides[attrId] !== undefined) {
        combo[attrId] = String(overrides[attrId]);
      } else {
        const first = spConfig.attributes[attrId]?.options?.[0];
        if (first) combo[attrId] = String(first.id);
      }
    });
    return combo;
  }

  function addRelation(spConfig, fromNodeId, toNodeId) {
    const [attrA, optA] = fromNodeId.split(':');
    const [attrB, optB] = toNodeId.split(':');
    const sorted = getSortedAttributeIds(spConfig.attributes ?? {});
    const colA = sorted.indexOf(attrA);
    const colB = sorted.indexOf(attrB);

    if (colB !== colA + 1) {
      return { error: 'Relations can only connect adjacent attribute columns (left → right).' };
    }
    if (!findOption(spConfig, attrA, optA) || !findOption(spConfig, attrB, optB)) {
      return { error: 'Invalid option nodes.' };
    }

    const index = spConfig.index ?? (spConfig.index = {});
    const existing = new Set(Object.values(index).map((c) => comboKey(c)));
    let created = 0;

    const sources = getProductsForOption(spConfig, attrA, optA);
    const templates = sources.length
      ? sources.map((pid) => ({ ...index[pid] }))
      : [buildDefaultCombo(spConfig, { [attrA]: optA })];

    templates.forEach((base) => {
      const combo = { ...base, [attrB]: String(optB) };
      const key = comboKey(combo);
      if (existing.has(key)) return;
      index[generateProductId(spConfig)] = combo;
      existing.add(key);
      created += 1;
    });

    rebuildProductsFromIndex(spConfig);
    return { created, from: fromNodeId, to: toNodeId };
  }

  function removeRelation(spConfig, fromNodeId, toNodeId) {
    const products = getProductsForEdge(spConfig, fromNodeId, toNodeId);
    removeProductsFromIndex(spConfig, products);
    return { removed: products.length, from: fromNodeId, to: toNodeId };
  }

  function updateOption(spConfig, attrId, optionId, fields) {
    const opt = findOption(spConfig, attrId, optionId);
    if (!opt) return { error: 'Option not found' };

    const oldPureId = getPureOptionId(opt.id);

    if (fields.label !== undefined) opt.label = fields.label;
    if (fields.optionValue !== undefined) opt.optionValue = fields.optionValue === '' ? null : fields.optionValue;
    if (fields.optionMeta !== undefined) opt.optionMeta = fields.optionMeta || null;

    if (fields.compound !== undefined) {
      applyCompoundToOption(opt, fields.compound);
    } else if (fields.id !== undefined) {
      const parsed = parseOptionCompound(fields.id);
      opt.id = parsed.id;
      if (parsed.value != null) opt.optionValue = parsed.value;
      if (parsed.extra) opt.optionMeta = parsed.extra;
    }

    const newPureId = getPureOptionId(opt.id);
    if (newPureId !== oldPureId) {
      Object.values(spConfig.index ?? {}).forEach((combo) => {
        if (getPureOptionId(combo[attrId]) === oldPureId) combo[attrId] = newPureId;
      });
    }

    rebuildProductsFromIndex(spConfig);
    return { option: opt, newNodeId: optionNodeKey(attrId, opt.id) };
  }

  function addOptionToAttribute(spConfig, attrId, label = 'New Option') {
    const attr = spConfig.attributes?.[attrId];
    if (!attr) return { error: 'Attribute not found' };
    const newId = generateOptionId();
    if (!attr.options) attr.options = [];
    attr.options.push({ id: newId, label, products: [], optionValue: null, optionMeta: null });
    return { optionId: newId, nodeId: optionNodeKey(attrId, newId) };
  }

  function removeOptionSmart(spConfig, attrId, optionId) {
    const attr = spConfig.attributes?.[attrId];
    if (!attr) return { error: 'Attribute not found' };
    const idx = (attr.options ?? []).findIndex(
      (o) => getPureOptionId(o.id) === getPureOptionId(optionId)
    );
    if (idx < 0) return { error: 'Option not found' };

    const productIds = getProductsForOption(spConfig, attrId, optionId);
    attr.options.splice(idx, 1);
    removeProductsFromIndex(spConfig, productIds);

    const orphans = [];
    Object.entries(spConfig.attributes).forEach(([aId, a]) => {
      a.options = (a.options ?? []).filter((opt) => {
        const count = getProductsForOption(spConfig, aId, opt.id).length;
        if (count === 0) {
          orphans.push({ attrId: aId, label: opt.label });
          return false;
        }
        return true;
      });
    });

    rebuildProductsFromIndex(spConfig);
    return { removedProducts: productIds.length, orphansRemoved: orphans };
  }

  function updateAttributeMeta(spConfig, attrId, fields) {
    const attr = spConfig.attributes?.[attrId];
    if (!attr) return { error: 'Attribute not found' };
    if (fields.label !== undefined) attr.label = fields.label;
    if (fields.code !== undefined) attr.code = fields.code;
    return { attr };
  }

  /**
   * Remove entire attribute from spConfig, strip from index,
   * then prune orphan options with zero remaining products.
   */
  function removeAttributeSmart(spConfig, attrId) {
    const attr = spConfig.attributes?.[attrId];
    if (!attr) return null;

    const report = {
      removedAttribute: { id: attrId, label: attr.label, code: attr.code },
      optionsRemoved: (attr.options ?? []).length,
      orphansRemoved: [],
      productsBefore: Object.keys(spConfig.index ?? {}).length,
    };

    delete spConfig.attributes[attrId];

    Object.values(spConfig.index ?? {}).forEach((combo) => {
      delete combo[attrId];
    });

    rebuildProductsFromIndex(spConfig);

    Object.entries(spConfig.attributes).forEach(([aId, a]) => {
      const before = (a.options ?? []).length;
      a.options = (a.options ?? []).filter((opt) => {
        const count = getProductsForOption(spConfig, aId, opt.id).length;
        if (count === 0) {
          report.orphansRemoved.push({
            attrId: aId,
            attrLabel: a.label,
            optionId: opt.id,
            label: opt.label,
          });
          return false;
        }
        return true;
      });
      if (a.options.length < before) {
        report.orphansRemovedCount = (report.orphansRemovedCount || 0) + (before - a.options.length);
      }
    });

    const remaining = getSortedAttributeIds(spConfig.attributes);
    updateAttributePositions(spConfig.attributes, remaining);

    report.productsAfter = Object.keys(spConfig.index ?? {}).length;
    report.remainingAttributes = remaining.length;

    return report;
  }

  return {
    ROOT_KEY,
    getSpConfig,
    setSpConfig,
    deepClone,
    getSortedAttributeIds,
    getStats,
    rebuildProductsFromIndex,
    removeProductsFromIndex,
    getProductsForOption,
    applyHiddenOptions,
    updateAttributePositions,
    validate,
    buildMatrix,
    exportMagentoJson,
    parseJson,
    buildRelationGraph,
    getRelatedNodeIds,
    getDownstreamOptions,
    removeAttributeSmart,
    getProductsForEdge,
    addRelation,
    removeRelation,
    updateOption,
    addOptionToAttribute,
    removeOptionSmart,
    updateAttributeMeta,
    findOption,
    parseOptionCompound,
    formatOptionCompound,
    getPureOptionId,
    normalizeSpConfigOptions,
    optionNodeKey,
  };
})();
