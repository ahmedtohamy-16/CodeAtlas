import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, FileCode2, Folder, FolderOpen, Search } from 'lucide-react';
import type { FileItem } from '../types';

type TreeItem = { name: string; path: string; file?: FileItem; children: Map<string, TreeItem> };
const badgeClass: Record<string, string> = { Python: 'py', TypeScript: 'ts', JavaScript: 'js', Rust: 'rs', Go: 'go', Java: 'java' };

function buildTree(files: FileItem[]): TreeItem {
  const root: TreeItem = { name: '', path: '', children: new Map() };
  for (const file of files) {
    const parts = file.path.split('/');
    let cursor = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/');
      let child = cursor.children.get(part);
      if (!child) { child = { name: part, path, children: new Map() }; cursor.children.set(part, child); }
      if (index === parts.length - 1) child.file = file;
      cursor = child;
    });
  }
  return root;
}

export function TreeExplorer({ files, selectedId, onSelect }: { files: FileItem[]; selectedId?: string; onSelect: (file: FileItem) => void }) {
  const [query, setQuery] = useState('');
  const tree = useMemo(() => buildTree(files), [files]);
  const filtered = useMemo(() => query.trim() ? files.filter((file) => file.path.toLowerCase().includes(query.toLowerCase())) : files, [files, query]);
  const visibleTree = useMemo(() => query.trim() ? buildTree(filtered) : tree, [filtered, query, tree]);

  function render(item: TreeItem, depth = 0): ReactNode {
    const children = [...item.children.values()].sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name));
    return <TreeRow key={item.path} item={item} depth={depth} selectedId={selectedId} onSelect={onSelect} queryActive={Boolean(query.trim())} renderChildren={() => children.map((child) => render(child, depth + 1))} />;
  }

  return <section className="tree-explorer" aria-label="Repository files"><div className="tree-toolbar"><span className="eyebrow">EXPLORER</span><span className="tree-count">{files.length.toLocaleString()} files</span></div><label className="tree-search"><Search size={14} /><input aria-label="Search files" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter files…" /></label>{filtered.length ? <div className="tree-list">{[...visibleTree.children.values()].sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name)).map((item) => render(item))}</div> : <div className="tree-no-results">No files match “{query}”.</div>}</section>
}

function TreeRow({ item, depth, selectedId, onSelect, queryActive, renderChildren }: { item: TreeItem; depth: number; selectedId?: string; onSelect: (file: FileItem) => void; queryActive: boolean; renderChildren: () => ReactNode }) {
  const [open, setOpen] = useState(depth === 0 || queryActive);
  const isFile = Boolean(item.file);
  const active = item.file?.id === selectedId;
  if (isFile) return <button className={`tree-file ${active ? 'active' : ''}`} style={{ paddingLeft: `${12 + depth * 14}px` }} onClick={() => item.file && onSelect(item.file)} title={item.path}><FileCode2 className={`file-type-icon ${badgeClass[item.file!.language] || ''}`} size={14} /><span className="tree-name">{item.name}</span><span className="tree-language">{badgeClass[item.file!.language] || item.file!.language.slice(0, 2).toLowerCase()}</span></button>;
  return <div className="tree-folder"><button className="tree-folder-button" style={{ paddingLeft: `${10 + depth * 14}px` }} onClick={() => setOpen(!open)} aria-expanded={open}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{open ? <FolderOpen size={14} /> : <Folder size={14} />}<span className="tree-name">{item.name}</span></button>{open && <div>{renderChildren()}</div>}</div>;
}
