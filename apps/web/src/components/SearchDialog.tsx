import { useEffect, useState } from 'react';
import { FileCode2, FunctionSquare, Search, X } from 'lucide-react';
import { searchRepository } from '../lib/api';
import type { Repository, SearchResult } from '../types';

export function SearchDialog({ repo, onClose, onSelect }: { repo: Repository; onClose: () => void; onSelect: (result: SearchResult) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!query.trim()) { setResults([]); setBusy(false); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      setBusy(true); setError('');
      searchRepository(repo.id, query.trim()).then((items) => { if (active) setResults(items); }).catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : 'Search failed'); }).finally(() => { if (active) setBusy(false); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, repo.id]);

  return <div className="modal-backdrop search-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="search-modal" role="dialog" aria-modal="true" aria-label="Search repository"><div className="search-input-wrap"><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files, classes, functions…" onKeyDown={(event) => event.key === 'Escape' && onClose()} /><kbd>ESC</kbd><button className="icon-button" aria-label="Close search" onClick={onClose}><X size={15} /></button></div><div className="search-results">{busy ? <div className="search-hint">Searching this repository…</div> : error ? <div className="search-hint error-text">{error}</div> : !query ? <div className="search-hint">Search across real files and Python symbols.</div> : results.length ? results.map((item) => <button className="search-result" key={item.id} onClick={() => onSelect(item)}><span className="search-result-icon">{item.type === 'file' ? <FileCode2 size={15} /> : <FunctionSquare size={15} />}</span><span className="search-result-main"><strong>{item.name}</strong><small>{item.path}{item.line ? `:${item.line}` : ''}</small></span><span className="result-type">{item.type}</span></button>) : <div className="search-hint">No files or symbols found for “{query}”.</div>}</div><footer className="search-footer"><span><kbd>↑</kbd> <kbd>↓</kbd> to navigate</span><span><kbd>↵</kbd> to open</span><span>Search is local to this analysis</span></footer></section></div>;
}
