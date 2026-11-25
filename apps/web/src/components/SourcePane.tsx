import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileCode2, LoaderCircle } from 'lucide-react';
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import { getSource } from '../lib/api';
import type { FileItem, Repository, SymbolItem } from '../types';

hljs.registerLanguage('python', python);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);

const languageKey: Record<string, string> = { Python: 'python', JavaScript: 'javascript', TypeScript: 'typescript', JSON: 'json', HTML: 'xml', CSS: 'css' };

export function SourcePane({ repo, file, symbol, onClose }: { repo: Repository; file: FileItem | null; symbol: SymbolItem | null; onClose?: () => void }) {
  const [data, setData] = useState<{ content: string; path: string; language: string; truncated: boolean } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!file) { setData(null); setError(''); return; }
    setLoading(true); setError('');
    getSource(repo.id, file.id).then((result) => { if (active) setData(result); }).catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : 'Source could not be loaded.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [repo.id, file]);

  const lines = useMemo(() => {
    if (!data) return [];
    const language = languageKey[data.language];
    let highlighted = data.content;
    if (language) {
      try { highlighted = hljs.highlight(data.content, { language, ignoreIllegals: true }).value; } catch { highlighted = data.content; }
    }
    return highlighted.split('\n');
  }, [data]);

  useEffect(() => {
    if (symbol) document.getElementById(`source-line-${symbol.line}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [symbol, data]);

  if (!file) return <div className="source-empty"><FileCode2 size={23} /><strong>Select a source file</strong><span>Choose a file or symbol to inspect its code.</span></div>;
  if (file.oversized) return <div className="source-empty"><AlertTriangle size={22} /><strong>Preview limit reached</strong><span>This file is larger than the 1 MB source preview limit.</span></div>;
  return <section className="source-pane" aria-label="Read-only source viewer">
    <header className="source-header"><div className="source-title"><FileCode2 size={15} /><span title={file.path}>{file.path}</span><span className="language-chip">{file.language}</span></div>{onClose && <button className="icon-button" aria-label="Close source viewer" onClick={onClose}>×</button>}</header>
    {loading ? <div className="source-loading"><LoaderCircle className="spin" size={18} /> Loading source…</div> : error ? <div className="source-error"><AlertTriangle size={16} />{error}</div> : data && <div className="code-scroll"><pre className="code-lines">{lines.map((line, index) => <div className={`code-row ${symbol && index + 1 >= symbol.line && index + 1 <= symbol.end_line ? 'selected-code' : ''}`} id={`source-line-${index + 1}`} key={index}><span className="line-number">{index + 1}</span><code dangerouslySetInnerHTML={{ __html: line || ' ' }} /></div>)}</pre>{data.truncated && <div className="truncation-note">Source preview truncated at 1 MB.</div>}</div>}
  </section>;
}
