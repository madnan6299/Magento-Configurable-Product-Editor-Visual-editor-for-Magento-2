# Magento-Configurable-Product-Editor-Visual-editor-for-Magento-2
Browser-based tool to import, visually edit, validate, and export Magento 2 configurable product configuration JSON — no backend required.

# Magento Configurable Product Editor

A browser-based visual editor for **Magento 2 configurable product** `spConfig` JSON.  
Import → edit visually → export Magento-compatible JSON. No server, no build step.

![Tech](https://img.shields.io/badge/Vanilla%20JS-ES6+-yellow)
![Magento](https://img.shields.io/badge/Magento%202-spConfig-orange)
![License](https://img.shields.io/badge/License-MIT-blue)

## Problem

Editing Magento configurable product configuration means working with large, nested JSON structures (`#product_addtocart_form` → `configurable` → `spConfig`). Manual edits are error-prone — especially for attributes, options, product index combinations, and variant relations.

## Solution

This tool provides a **visual, validated editing workflow** for Magento spConfig data:

- **Import** — paste JSON or upload a `.json` file
- **Edit** — list view, relation graph, or combination matrix
- **Validate** — real-time structure and index checks
- **Export** — live Magento-compatible JSON (copy or download)

## Features

### List Editor
- Drag-and-drop reorder of attributes and options (SortableJS)
- Edit labels, codes, positions, and compound option IDs
- Hide options (excluded from export) or remove them with index cleanup
- Smart Remove — delete an attribute and auto-prune orphan options

### Relation Graph (n8n-style)
- SVG-based interactive graph of option dependencies
- Pan, zoom, drag output → input ports to add relations
- Inspector panel for editing nodes, edges, and attributes
- Edge weights reflect number of product combinations

### Combination Matrix
- Cross-tab view of two attributes
- Shows which option pairs exist in the product index

### Magento-Specific Logic
- Supports compound option format: `114 | 6.48 | extra meta`
- Pure ID used in index; display value shown in UI
- Rebuilds `options.products` from index on sync
- Validates index vs. option product lists

## Tech Stack

| Layer | Technology |
|-------|------------|
| Core | Vanilla JavaScript (ES6+), modular IIFE pattern |
| UI | HTML5, CSS3 (dark theme) |
| Drag & Drop | [SortableJS](https://sortablejs.github.io/Sortable/) |
| Graph | Custom SVG renderer (no D3/Cytoscape) |
| Backend | None — runs entirely in the browser |

## Project Structure

magento-config-editor/ ├── index.html # Main app shell ├── css/styles.css # UI styling ├── js/ │ ├── magento-core.js # spConfig parsing, validation, export logic │ ├── editor.js # List editor & matrix rendering │ ├── graph.js # SVG relation graph editor │ └── app.js # Application state & orchestration └── magento_sample_json.json

## Quick Start

1. Clone the repo
2. Open `index.html` in a browser (or serve locally)
3. Click **Load Sample** or paste your Magento JSON
4. Edit in List / Graph / Matrix tabs
5. **Copy Output** or **Download JSON**

> Works with JSON exported from Magento 2 configurable products (`x-magento-init` / `#product_addtocart_form` structure).

## Use Cases

- Catalog managers cleaning up configurable product options
- Developers debugging spConfig / index mismatches
- Migrating or restructuring variant combinations
- Prototyping attribute relations before Magento admin changes

## Author

Muhammad Adnan — https://www.linkedin.com/in/madnan6299 · +923007306299

## License

MIT
