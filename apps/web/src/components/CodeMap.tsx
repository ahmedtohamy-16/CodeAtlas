import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import { Focus, Layers3, Minus, Plus, RotateCcw, Search } from 'lucide-react';
import type { GraphData, GraphNode } from '../types';

export function CodeMap({ data, selectedId, onSelect, truncated }: { data: GraphData; selectedId?: string; onSelect: (node: GraphNode) => void; truncated?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const core = useRef<Core | null>(null);
  const nodesRef = useRef(data.nodes);
  const onSelectRef = useRef(onSelect);
  const [filter, setFilter] = useState('');
  const [showFiles, setShowFiles] = useState(true);
  const [showSymbols, setShowSymbols] = useState(true);
  const [layoutName, setLayoutName] = useState<'cose' | 'breadthfirst'>('cose');
  nodesRef.current = data.nodes;
  onSelectRef.current = onSelect;

  const elements = useMemo(() => {
    const nodes = data.nodes.filter((node) => (node.kind === 'file' ? showFiles : showSymbols) && (!filter || `${node.name} ${node.path}`.toLowerCase().includes(filter.toLowerCase())));
    const visibleIds = new Set(nodes.map((node) => node.id));
    const edges = data.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
    return [...nodes.map((node) => ({ data: { ...node, label: node.kind === 'file' ? node.name.split('/').pop() : node.name, id: node.id } })), ...edges.map((edge) => ({ data: edge }))];
  }, [data, filter, showFiles, showSymbols]);

  useEffect(() => {
    if (!host.current) return;
    const cy = cytoscape({
      container: host.current,
      elements,
      minZoom: 0.15,
      maxZoom: 3,
      wheelSensitivity: 0.22,
      style: [
        { selector: 'node', style: { 'label': 'data(label)', 'font-family': 'Inter, system-ui, sans-serif', 'font-size': '10px', 'color': '#c8d0db', 'text-wrap': 'ellipsis', 'text-max-width': '120px', 'text-valign': 'bottom', 'text-margin-y': 7, 'background-color': '#41c7dc', 'width': 24, 'height': 24, 'border-width': 1, 'border-color': '#0d1820' } },
        { selector: 'node[kind = "file"]', style: { 'shape': 'round-rectangle', 'background-color': '#1f7a90', 'width': 36, 'height': 25, 'font-size': '9px' } },
        { selector: 'node[kind = "class"]', style: { 'shape': 'diamond', 'background-color': '#a78bfa', 'width': 22, 'height': 22 } },
        { selector: 'node[kind = "method"]', style: { 'shape': 'ellipse', 'background-color': '#e8a557', 'width': 16, 'height': 16 } },
        { selector: 'node[kind = "function"]', style: { 'shape': 'ellipse', 'background-color': '#58c89a', 'width': 18, 'height': 18 } },
        { selector: 'edge', style: { 'curve-style': 'bezier', 'line-color': '#364554', 'target-arrow-color': '#526478', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.7, width: 1, opacity: 0.72 } },
        { selector: 'edge[kind = "contains"]', style: { 'line-style': 'dashed', 'line-color': '#283540', 'target-arrow-shape': 'none', width: 0.8, opacity: 0.6 } },
        { selector: 'node:selected', style: { 'border-width': 2, 'border-color': '#d8f5fb', 'overlay-color': '#43c7df', 'overlay-opacity': 0.14 } },
        { selector: '.dimmed', style: { opacity: 0.16 } },
        { selector: '.related', style: { opacity: 1, 'line-color': '#4cc9de', 'target-arrow-color': '#4cc9de', width: 2 } },
      ],
      layout: { name: layoutName, animate: false, fit: true, padding: 55, nodeRepulsion: 9000, idealEdgeLength: 100, gravity: 0.2, nodeDimensionsIncludeLabels: true },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
    });
    cy.on('tap', 'node', (event) => {
      const id = event.target.id();
      const node = nodesRef.current.find((item) => item.id === id);
      if (node) onSelectRef.current(node);
    });
    core.current = cy;
    const observer = new ResizeObserver(() => cy.resize());
    observer.observe(host.current);
    return () => { observer.disconnect(); cy.destroy(); core.current = null; };
  }, [elements, layoutName]);

  useEffect(() => {
    if (!core.current || !selectedId) return;
    const node = core.current.getElementById(selectedId);
    if (node.empty()) return;
    core.current.elements().addClass('dimmed');
    node.removeClass('dimmed').addClass('related');
    node.closedNeighborhood().removeClass('dimmed').addClass('related');
    core.current.animate({ center: { eles: node }, duration: 240 });
  }, [selectedId]);

  const cy = core;
  function zoom(factor: number) { if (cy.current) cy.current.zoom({ level: cy.current.zoom() * factor, renderedPosition: { x: (host.current?.clientWidth ?? 0) / 2, y: (host.current?.clientHeight ?? 0) / 2 } }); }
  function reset() { if (cy.current) { cy.current.elements().removeClass('dimmed related'); cy.current.fit(undefined, 50); } }
  function highlight(direction: 'incoming' | 'outgoing') {
    const instance = cy.current;
    if (!instance) return;
    if (!selectedId) return;
    const selected = instance.getElementById(selectedId);
    instance.elements().addClass('dimmed');
    selected.removeClass('dimmed').addClass('related');
    (direction === 'incoming' ? selected.incomers() : selected.outgoers()).removeClass('dimmed').addClass('related');
  }
  function focusSelected() { if (cy.current && selectedId) { const node = cy.current.getElementById(selectedId); if (!node.empty()) cy.current.animate({ center: { eles: node }, zoom: Math.max(cy.current.zoom(), 1.1), duration: 240 }); } }

  return <section className="graph-stage" aria-label="Interactive dependency map"><div className="graph-toolbar"><label className="graph-filter"><Search size={14} /><input aria-label="Filter graph nodes" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter nodes…" /></label><div className="graph-controls"><button className={showFiles ? 'control-button active' : 'control-button'} onClick={() => setShowFiles(!showFiles)}><span className="legend-dot file-dot" /> Files</button><button className={showSymbols ? 'control-button active' : 'control-button'} onClick={() => setShowSymbols(!showSymbols)}><span className="legend-dot symbol-dot" /> Symbols</button><span className="control-divider" /><button className="control-button" onClick={() => highlight('incoming')} title="Highlight incoming dependencies">Incoming</button><button className="control-button" onClick={() => highlight('outgoing')} title="Highlight outgoing dependencies">Outgoing</button><button className="control-button" onClick={focusSelected} title="Focus selected node"><Focus size={14} /></button></div></div><div className="graph-canvas-wrap"><div ref={host} className="graph-canvas" role="img" aria-label="Dependency graph. Drag nodes to rearrange, scroll to zoom, and click a node to inspect." />{data.nodes.length === 0 && <div className="graph-empty"><Layers3 size={26} /><strong>No graph nodes</strong><span>Analysis has not found files to visualize.</span></div>}{truncated && <div className="graph-limit-note">Showing a bounded graph to keep large repositories responsive.</div>}<div className="graph-legend"><span><i className="legend-dot file-dot" />File</span><span><i className="legend-dot function-dot" />Function</span><span><i className="legend-dot class-dot" />Class</span><span><i className="legend-dot method-dot" />Method</span><span><i className="legend-line" />Import</span></div><div className="graph-zoom"><button aria-label="Zoom in" onClick={() => zoom(1.2)}><Plus size={14} /></button><button aria-label="Zoom out" onClick={() => zoom(0.82)}><Minus size={14} /></button><button aria-label="Reset graph view" onClick={reset}><RotateCcw size={14} /></button><button aria-label="Change graph layout" onClick={() => setLayoutName(layoutName === 'cose' ? 'breadthfirst' : 'cose')}><Layers3 size={14} /></button></div></div><div className="graph-footer"><span><span className="live-indicator" /> {data.nodes.length.toLocaleString()} visible nodes · {data.edges.filter((edge) => edge.kind !== 'contains').length.toLocaleString()} imports</span><span>Drag to rearrange · Scroll to zoom · Click to inspect</span></div></section>;
}
