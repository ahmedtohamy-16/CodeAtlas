import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, Braces, Check, ChevronRight, CircleHelp, Code2, Command, Database, Download, FileCode2, GitBranch, GitCommitHorizontal, GitCompareArrows, GitFork, Layers3, LoaderCircle, Network, Plus, RefreshCw, Search, ShieldCheck, Waypoints, X } from 'lucide-react';
import { ImportDialog } from './components/ImportDialog';
import { SearchDialog } from './components/SearchDialog';
import { SourcePane } from './components/SourcePane';
import { TreeExplorer } from './components/TreeExplorer';
import { analyzeRepository, getDependencies, getGit, getGraph, getImpact, getRepository, importRepository, listFiles, listRepositories, listSymbols } from './lib/api';
import type { DependencyReport, FileItem, GitReport, GraphData, GraphNode, ImpactReport, Repository, SearchResult, SymbolItem } from './types';

const CodeMap = lazy(() => import('./components/CodeMap').then((module) => ({ default: module.CodeMap })));

 type View = 'graph' | 'explorer' | 'dependencies' | 'impact' | 'git' | 'settings';
const nav: { id: View; label: string; icon: typeof Network }[] = [
  { id: 'graph', label: 'Code map', icon: Network },
  { id: 'explorer', label: 'Explorer', icon: FileCode2 },
  { id: 'dependencies', label: 'Dependencies', icon: GitFork },
  { id: 'impact', label: 'Impact analysis', icon: GitCompareArrows },
  { id: 'git', label: 'Git history', icon: GitBranch },
];

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function shortHash(value?: string | null) { return value ? value.slice(0, 8) : '—'; }
function timeAgo(value?: string | null) {
  if (!value) return 'Not analyzed yet';
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}

export default function App() {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [repo, setRepo] = useState<Repository | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [symbols, setSymbols] = useState<SymbolItem[]>([]);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [dependencies, setDependencies] = useState<DependencyReport | null>(null);
  const [git, setGit] = useState<GitReport | null>(null);
  const [impact, setImpact] = useState<ImpactReport | null>(null);
  const [activeView, setActiveView] = useState<View>('graph');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedSymbolId, setSelectedSymbolId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pageError, setPageError] = useState('');
  const [filterLanguage, setFilterLanguage] = useState('');
  const [filterDirectory, setFilterDirectory] = useState('');
  const repositoryId = repo?.id;
  const repositoryStatus = repo?.status;

  const selectedSymbol = useMemo(() => symbols.find((item) => item.id === selectedSymbolId) ?? null, [symbols, selectedSymbolId]);
  const selectedFile = useMemo(() => {
    if (selectedSymbol) return files.find((item) => item.id === selectedSymbol.file_id) ?? null;
    if (!selectedNode) return null;
    return files.find((item) => item.id === selectedNode.id || item.id === selectedNode.file_id || item.path === selectedNode.path) ?? null;
  }, [files, selectedNode, selectedSymbol]);
  const reloadRepositories = useCallback(async () => {
    const items = await listRepositories();
    setRepositories(items);
    return items;
  }, []);

  const refreshWorkspace = useCallback(async (id: string) => {
    const [nextRepo, nextFiles, nextSymbols] = await Promise.all([getRepository(id), listFiles(id), listSymbols(id)]);
    setRepo(nextRepo); setFiles(nextFiles); setSymbols(nextSymbols);
    if (nextRepo.status === 'complete') {
      const results = await Promise.allSettled([getDependencies(id), getGit(id)]);
      if (results[0].status === 'fulfilled') setDependencies(results[0].value);
      if (results[1].status === 'fulfilled') setGit(results[1].value);
    }
    return nextRepo;
  }, []);

  useEffect(() => {
    let active = true;
    listRepositories().then((items) => {
      if (!active) return;
      setRepositories(items);
      if (items.length) return refreshWorkspace(items[0].id).then((selected) => { if (active) setRepo(selected); });
      return undefined;
    }).catch((err: unknown) => { if (active) setPageError(err instanceof Error ? err.message : 'Could not connect to the CodeAtlas API.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshWorkspace]);

  useEffect(() => {
    if (!repositoryId || !repositoryStatus || !['queued', 'analyzing'].includes(repositoryStatus)) return;
    const stream = new EventSource(`/api/repositories/${encodeURIComponent(repositoryId)}/progress`);
    stream.addEventListener('progress', (event) => {
      const state = JSON.parse((event as MessageEvent).data) as { status: Repository['status']; progress: number; message: string; error?: string | null };
      setRepo((current) => current && current.id === repositoryId ? { ...current, status: state.status, progress: state.progress, progress_message: state.message, error: state.error ?? null } : current);
      if (state.status === 'complete' || state.status === 'failed') {
        stream.close();
        if (state.status === 'complete') {
          refreshWorkspace(repositoryId).then(() => reloadRepositories()).catch((err: unknown) => setPageError(err instanceof Error ? err.message : 'Could not refresh analysis.'));
        }
      }
    });
    stream.onerror = () => { stream.close(); };
    return () => stream.close();
  }, [repositoryId, repositoryStatus, refreshWorkspace, reloadRepositories]);

  useEffect(() => {
    if (!repositoryId || repositoryStatus !== 'complete') return;
    getGraph(repositoryId, { language: filterLanguage || undefined, directory: filterDirectory || undefined }).then(setGraph).catch((err: unknown) => setPageError(err instanceof Error ? err.message : 'Graph could not be loaded.'));
  }, [filterLanguage, filterDirectory, repositoryId, repositoryStatus]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); setImportOpen(true); }
      if (event.key === 'Escape') { setSearchOpen(false); setImportOpen(false); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);

  async function handleImport(input: { file?: File; url?: string }) {
    const imported = await importRepository(input);
    setImportOpen(false); setRepositories((old) => [imported, ...old.filter((item) => item.id !== imported.id)]);
    setRepo(imported); setFiles([]); setSymbols([]); setGraph(null); setDependencies(null); setSelectedNode(null); setSelectedSymbolId(null); setActiveView('graph');
    void refreshWorkspace(imported.id).catch(() => undefined);
  }

  async function selectRepository(item: Repository) {
    setSelectedNode(null); setSelectedSymbolId(null); setGraph(null); setDependencies(null); setGit(null);
    setRepo(item); setPageError('');
    try { await refreshWorkspace(item.id); } catch (err) { setPageError(err instanceof Error ? err.message : 'Could not load repository.'); }
  }

  async function refreshAnalysis() {
    if (!repo) return;
    setRefreshing(true); setPageError('');
    try { const queued = await analyzeRepository(repo.id); setRepo(queued); }
    catch (err) { setPageError(err instanceof Error ? err.message : 'Could not start analysis.'); }
    finally { setRefreshing(false); }
  }

  async function exportAnalysis() {
    if (!repo || repo.status !== 'complete') return;
    setExporting(true); setPageError('');
    try {
      const response = await fetch(`/api/repositories/${encodeURIComponent(repo.id)}/export`);
      if (!response.ok) throw new Error(`Export failed (${response.status})`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${repo.name.replace(/[^a-z0-9._-]+/gi, '-')}-codeatlas-analysis.json`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) { setPageError(err instanceof Error ? err.message : 'Could not export analysis.'); }
    finally { setExporting(false); }
  }

  function selectGraphNode(node: GraphNode) {
    setSelectedNode(node);
    setSelectedSymbolId(node.kind === 'file' ? null : node.id);
  }
  function selectFile(file: FileItem) {
    setSelectedNode({ id: file.id, name: file.path.split('/').pop() || file.path, path: file.path, kind: 'file', language: file.language });
    setSelectedSymbolId(null); setActiveView('explorer');
  }
  function openSearchResult(result: SearchResult) {
    if (result.type === 'file') {
      const file = files.find((item) => item.id === result.file_id);
      if (file) selectFile(file);
    } else {
      const symbol = symbols.find((item) => item.id === result.id);
      const file = files.find((item) => item.id === result.file_id);
      setSelectedNode({ id: result.id, name: result.name.split('.').pop() || result.name, path: result.path, kind: result.type, language: 'Python', file_id: result.file_id, line: result.line });
      setSelectedSymbolId(symbol?.id ?? null);
      if (file) setActiveView('explorer');
    }
    setSearchOpen(false);
  }

  useEffect(() => {
    if (!repositoryId || !selectedSymbolId || repositoryStatus !== 'complete') { setImpact(null); return; }
    getImpact(repositoryId, selectedSymbolId).then(setImpact).catch(() => setImpact(null));
  }, [repositoryId, selectedSymbolId, repositoryStatus]);

  if (loading) return <div className="app-loading"><div className="brand-mark large"><Waypoints size={24} /></div><span>Opening CodeAtlas…</span></div>;

  return <div className="app-shell">
    <aside className="side-rail">
      <div className="brand-block"><div className="brand-mark"><Waypoints size={18} strokeWidth={2.2} /></div><div><strong>CodeAtlas</strong><span>CODEBASE INTELLIGENCE</span></div></div>
      <button className="new-repo-button" onClick={() => setImportOpen(true)}><Plus size={16} /><span>Open repository</span><kbd>⌘ O</kbd></button>
      <div className="nav-section"><span className="eyebrow">WORKSPACE</span>{nav.map((item) => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${activeView === item.id ? 'active' : ''}`} onClick={() => setActiveView(item.id)} disabled={!repo}><Icon size={16} /><span>{item.label}</span>{item.id === 'graph' && activeView === 'graph' && <span className="nav-active-mark" />}</button>; })}<button className={`nav-item settings-link ${activeView === 'settings' ? 'active' : ''}`} onClick={() => setActiveView('settings')}><Database size={16} /><span>Settings & coverage</span></button></div>
      <div className="recent-section"><div className="section-title"><span className="eyebrow">RECENT REPOSITORIES</span><button className="icon-button tiny" aria-label="Refresh repositories" onClick={() => reloadRepositories().catch(() => undefined)}><RefreshCw size={12} /></button></div>{repositories.length ? <div className="recent-list">{repositories.slice(0, 6).map((item) => <button key={item.id} className={`recent-item ${repo?.id === item.id ? 'current' : ''}`} onClick={() => selectRepository(item)}><span className={`repo-state-dot ${item.status}`} /><span className="recent-name">{item.name}</span><span className="recent-source">{item.source === 'github' ? 'GH' : 'ZIP'}</span></button>)}</div> : <div className="recent-empty">Your repositories will appear here.</div>}</div>
      <div className="side-bottom"><div className="safety-card"><ShieldCheck size={15} /><span>Workspace analysis<br /><small>Imported code is never executed.</small></span></div><button className="side-help" onClick={() => setActiveView('settings')}><CircleHelp size={14} /> About CodeAtlas MVP</button></div>
    </aside>

    <div className="main-column">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={13} /><strong>{repo?.name ?? 'No repository'}</strong>{repo?.current_branch && <span className="branch-pill"><GitBranch size={12} />{repo.current_branch}</span>}</div><div className="top-actions"><button className="search-trigger" onClick={() => repo && setSearchOpen(true)} disabled={!repo}><Search size={14} /><span>Search repository</span><kbd><Command size={11} /> K</kbd></button>{repo?.status === 'complete' && <button className="button secondary small" onClick={exportAnalysis} disabled={exporting} title="Download analysis metadata as JSON">{exporting ? <LoaderCircle className="spin" size={13} /> : <Download size={13} />} Export</button>}<button className="button secondary small" onClick={() => setImportOpen(true)}><Plus size={14} /> Import</button><div className="top-avatar" aria-label="Workspace">CA</div></div></header>
      {repo && <div className="repo-summary"><div className="repo-title-block"><div className="repo-icon"><Code2 size={19} /></div><div><div className="repo-title-line"><h1>{repo.name}</h1><span className={`status-tag ${repo.status}`}>{repo.status === 'complete' ? <Check size={11} /> : repo.status === 'failed' ? <AlertTriangle size={11} /> : <span className="tiny-spinner" />}{repo.status === 'complete' ? 'Analyzed' : repo.status === 'failed' ? 'Failed' : repo.status === 'queued' ? 'Queued' : 'Analyzing'}</span></div><p>{repo.source === 'github' ? 'Public GitHub repository' : 'Imported ZIP archive'} <span className="meta-separator">·</span> Last analysis {timeAgo(repo.last_analyzed)}</p></div></div><div className="summary-metrics"><Metric label="FILES" value={repo.status === 'complete' ? repo.stats.file_count ?? '—' : '—'} icon={<FileCode2 size={14} />} /><Metric label="PYTHON SYMBOLS" value={repo.status === 'complete' ? repo.stats.symbol_count ?? '—' : '—'} icon={<Braces size={14} />} /><Metric label="IMPORT EDGES" value={repo.status === 'complete' ? repo.stats.imports_confirmed ?? '—' : '—'} icon={<GitFork size={14} />} /><Metric label="CYCLES" value={repo.status === 'complete' ? dependencies?.cycle_count ?? '—' : '—'} icon={<Waypoints size={14} />} /></div><button className="button secondary refresh-button" onClick={refreshAnalysis} disabled={refreshing || ['queued', 'analyzing'].includes(repo.status)}>{refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Analyze</button></div>}
      {!repo ? <EmptyRepository onImport={() => setImportOpen(true)} error={pageError} /> : <>
        {['queued', 'analyzing'].includes(repo.status) && <div className="analysis-banner"><div className="analysis-banner-icon"><Activity size={16} /></div><div className="analysis-progress-copy"><strong>{repo.status === 'queued' ? 'Preparing analysis' : repo.progress_message}</strong><span>Scanning repository source with the Python AST · no project code is executed.</span></div><div className="progress-value">{repo.progress}%</div><div className="progress-track"><div className="progress-fill" style={{ width: `${repo.progress}%` }} /></div></div>}
        {repo.status === 'failed' && <div className="failure-banner"><AlertTriangle size={16} /><div><strong>Analysis did not complete</strong><span>{repo.error ?? 'An unexpected error interrupted the scan.'}</span></div><button className="button secondary small" onClick={refreshAnalysis}>Retry</button></div>}
        {pageError && <div className="page-error"><AlertTriangle size={14} />{pageError}<button className="icon-button tiny" onClick={() => setPageError('')} aria-label="Dismiss error"><X size={13} /></button></div>}
        {repo.status === 'complete' && <div className="workspace-layout">
          <aside className="repository-panel"><div className="panel-header"><span className="eyebrow">REPOSITORY</span>{filterDirectory && <button className="text-button" onClick={() => setFilterDirectory('')}>Clear filter <X size={11} /></button>}</div><div className="repository-root"><span className="root-indicator" />{repo.name}<span className="root-menu">{files.length.toLocaleString()}</span></div><TreeExplorer files={files} selectedId={selectedFile?.id} onSelect={selectFile} /></aside>
          <main className="content-stage">
            {activeView === 'graph' && <><div className="content-heading"><div><span className="eyebrow">ARCHITECTURE VIEW</span><h2>Code map</h2><p>Explore how files and Python symbols connect.</p></div><div className="filter-controls"><select aria-label="Filter graph by language" value={filterLanguage} onChange={(event) => setFilterLanguage(event.target.value)}><option value="">All languages</option>{Object.keys(repo.stats.languages ?? {}).sort().map((language) => <option key={language} value={language}>{language}{language !== 'Python' ? ' · detected only' : ''}</option>)}</select><select aria-label="Filter graph by directory" value={filterDirectory} onChange={(event) => setFilterDirectory(event.target.value)}><option value="">All directories</option>{[...new Set(files.filter((item) => item.path.includes('/')).map((item) => item.path.split('/')[0]))].sort().map((directory) => <option key={directory} value={directory}>{directory}</option>)}</select></div></div>{graph ? <Suspense fallback={<div className="panel-loading"><LoaderCircle className="spin" size={18} /> Loading graph engine…</div>}><CodeMap data={graph} selectedId={selectedNode?.id} onSelect={selectGraphNode} truncated={graph.truncated} /></Suspense> : <div className="panel-loading"><LoaderCircle className="spin" size={18} /> Preparing dependency map…</div>}</>}
            {activeView === 'explorer' && <><div className="content-heading"><div><span className="eyebrow">SOURCE EXPLORER</span><h2>Read the code</h2><p>Read-only source view with symbol location and syntax highlighting.</p></div>{selectedFile && <span className="file-meta-pill">{selectedFile.line_count?.toLocaleString() ?? '—'} lines <span>·</span> {formatBytes(selectedFile.size_bytes)}</span>}</div><div className="explorer-view"><SourcePane repo={repo} file={selectedFile} symbol={selectedSymbol} /></div></>}
            {activeView === 'dependencies' && <DependenciesView data={dependencies} onOpenFile={(path) => { const item = files.find((entry) => entry.path === path); if (item) selectFile(item); }} />}
            {activeView === 'impact' && <ImpactView symbols={symbols} files={files} selectedId={selectedSymbolId} impact={impact} onSelect={(symbol) => { setSelectedSymbolId(symbol.id); setSelectedNode({ id: symbol.id, name: symbol.name, path: files.find((item) => item.id === symbol.file_id)?.path ?? '', kind: symbol.kind, language: 'Python', file_id: symbol.file_id, line: symbol.line }); }} />}
            {activeView === 'git' && <GitView git={git} />}
            {activeView === 'settings' && <SettingsView repo={repo} files={files} />}
          </main>
          <aside className="inspector-panel"><Inspector repo={repo} file={selectedFile} symbol={selectedSymbol} dependencies={dependencies} impact={impact} onOpenSource={() => setActiveView('explorer')} onClose={() => { setSelectedNode(null); setSelectedSymbolId(null); }} /></aside>
        </div>}
      </>}
    </div>
    {importOpen && <ImportDialog onImport={handleImport} onClose={() => setImportOpen(false)} />}
    {searchOpen && repo && <SearchDialog repo={repo} onClose={() => setSearchOpen(false)} onSelect={openSearchResult} />}
  </div>;
}

function Metric({ label, value, icon }: { label: string; value: number | string; icon: ReactNode }) { return <div className="metric"><span className="metric-icon">{icon}</span><span className="metric-value">{typeof value === 'number' ? value.toLocaleString() : value}</span><span className="metric-label">{label}</span></div>; }

function EmptyRepository({ onImport, error }: { onImport: () => void; error: string }) {
  return <main className="empty-workspace"><div className="empty-glow" /><div className="empty-mark"><Waypoints size={32} /></div><span className="eyebrow">CODE ATLAS · CODE INTELLIGENCE</span><h1>See how your codebase<br /><em>fits together.</em></h1><p>Map Python modules, inspect real symbols, and understand import impact before your next change.</p><button className="button primary large-button" onClick={onImport}><Plus size={16} /> Open a repository</button><div className="empty-import-options"><span><GithubLabel /> Public GitHub URL</span><span><FileCode2 size={14} /> ZIP archive · up to 100 MB</span></div>{error && <div className="empty-error"><AlertTriangle size={14} />{error}</div>}<div className="empty-capabilities"><div><Network size={16} /><strong>Dependency graph</strong><small>Verified in-repository imports</small></div><div><Braces size={16} /><strong>Python AST</strong><small>Symbols extracted without execution</small></div><div><ShieldCheck size={16} /><strong>Workspace analysis</strong><small>No code sent to AI services</small></div></div><span className="empty-footnote">No demo data. Your map appears after a real repository is analyzed.</span></main>;
}
function GithubLabel() { return <GitBranch size={14} />; }

function Inspector({ repo, file, symbol, dependencies, impact, onOpenSource, onClose }: { repo: Repository; file: FileItem | null; symbol: SymbolItem | null; dependencies: DependencyReport | null; impact: ImpactReport | null; onOpenSource: () => void; onClose: () => void }) {
  const related = dependencies?.imports.filter((item) => file && (item.source === file.path || item.target === file.path)) ?? [];
  return <div className="inspector-content"><div className="inspector-header"><div><span className="eyebrow">INSPECTOR</span><h3>{symbol ? symbol.kind : file ? 'File details' : 'No selection'}</h3></div>{(file || symbol) && <button className="icon-button tiny" onClick={onClose} aria-label="Clear selection"><X size={14} /></button>}</div>{!file && !symbol ? <div className="inspector-empty"><div className="inspector-empty-mark"><Layers3 size={21} /></div><strong>Explore the map</strong><span>Select a node to inspect its location, source, and import relationships.</span></div> : <><div className="inspector-symbol"><div className={`symbol-type-icon ${symbol?.kind ?? 'file'}`}>{symbol ? symbol.kind === 'class' ? <Boxes size={17} /> : <Braces size={17} /> : <FileCode2 size={17} />}</div><div className="symbol-titles"><strong>{symbol?.qualified_name ?? file?.path}</strong><span>{file?.path ?? 'Source file'}</span></div></div><div className="inspector-meta-grid"><div><span>LANGUAGE</span><strong>{file?.language ?? 'Python'}</strong></div><div><span>LINE</span><strong>{symbol ? symbol.line : file?.line_count ? `${file.line_count} lines` : '—'}</strong></div><div><span>SIZE</span><strong>{formatBytes(file?.size_bytes)}</strong></div><div><span>TYPE</span><strong>{symbol?.kind ?? file?.extension ?? 'File'}</strong></div></div>{symbol?.docstring && <div className="docstring"><span className="eyebrow">DOCSTRING</span><p>{symbol.docstring}</p></div>}{file && <div className="inspector-source"><div className="section-title"><span className="eyebrow">SOURCE PREVIEW</span><button className="text-button" onClick={onOpenSource}>Open file <ArrowUpRight size={12} /></button></div><SourcePane repo={repo} file={file} symbol={symbol} /></div>}{file && <div className="inspector-relations"><div className="section-title"><span className="eyebrow">FILE IMPORT RELATIONSHIPS</span><span className="relation-count">{related.length}</span></div>{related.length ? related.slice(0, 5).map((item) => <div className="relation-row" key={item.id}><span className={`confidence-dot ${item.confidence}`} /><span className="relation-path">{item.source === file.path ? `imports ${item.target ?? 'external module'}` : `imported by ${item.source}`}</span><span className="line-hint">{item.line ?? ''}</span></div>) : <div className="muted-note">No parsed import edge for this file.</div>}</div>}{symbol && impact && <div className="inspector-impact"><div className="section-title"><span className="eyebrow">IMPORT-LEVEL IMPACT</span><span className="impact-count">{impact.affected_count ?? 0}</span></div><p>{impact.scope}</p></div>}</>}</div>;
}

function DependenciesView({ data, onOpenFile }: { data: DependencyReport | null; onOpenFile: (path: string) => void }) {
  if (!data) return <div className="panel-loading"><LoaderCircle size={17} className="spin" /> Loading dependency analysis…</div>;
  return <div className="report-view"><div className="content-heading"><div><span className="eyebrow">GRAPH ANALYSIS</span><h2>Dependencies</h2><p>Computed from confirmed in-repository Python imports.</p></div><span className="analysis-badge"><Activity size={13} /> NetworkX analysis</span></div><div className="report-cards"><div className="report-card"><span className="report-card-icon"><Network size={16} /></span><strong>{data.confirmed_import_edges}</strong><span>Confirmed import edges</span></div><div className="report-card"><span className="report-card-icon cycle"><Waypoints size={16} /></span><strong>{data.cycle_count}</strong><span>Circular components</span></div><div className="report-card"><span className="report-card-icon muted"><FileCode2 size={16} /></span><strong>{data.isolated_total}</strong><span>Isolated files</span></div></div><div className="report-section"><div className="section-title"><h3>Detected cycles</h3><span>{data.cycles.length} components</span></div>{data.cycles.length ? data.cycles.map((cycle, index) => <div className="cycle-row" key={index}><span className="cycle-index">C{String(index + 1).padStart(2, '0')}</span><div>{cycle.map((path) => <button className="path-link" key={path} onClick={() => onOpenFile(path)}>{path}</button>)}</div><span className="cycle-loop">cycle</span></div>) : <div className="report-empty"><Check size={15} />No circular import components were detected in the confirmed graph.</div>}</div><div className="report-section"><div className="section-title"><h3>Most connected files</h3><span>In-degree + out-degree</span></div>{data.highly_connected.length ? data.highly_connected.map((item) => <div className="hub-row" key={item.path}><button className="path-link" onClick={() => onOpenFile(item.path)}>{item.path}</button><div className="hub-bar"><span style={{ width: `${Math.max(4, item.dependencies / Math.max(1, data.highly_connected[0].dependencies) * 100)}%` }} /></div><span>{item.dependencies}</span></div>) : <div className="report-empty">No confirmed internal imports to rank.</div>}</div><div className="report-section"><div className="section-title"><h3>Import statements</h3><span>{data.imports.length}{data.imports_truncated ? '+' : ''} relationships</span></div><div className="import-table"><div className="import-table-head"><span>FROM</span><span>IMPORT</span><span>CONFIDENCE</span><span>LINE</span></div>{data.imports.slice(0, 100).map((item) => <div className="import-row" key={item.id}><button className="path-link" onClick={() => onOpenFile(item.source)}>{item.source}</button><span className="import-destination">{item.target ?? item.detail}</span><span className={`confidence-label ${item.confidence}`}>{item.confidence}</span><span className="line-hint">{item.line ?? '—'}</span></div>)}</div>{!data.imports.length && <div className="report-empty">No Python import statements were extracted.</div>}</div><div className="coverage-note"><CircleHelp size={14} />{data.coverage_note}</div></div>;
}

function ImpactView({ symbols, files, selectedId, impact, onSelect }: { symbols: SymbolItem[]; files: FileItem[]; selectedId: string | null; impact: ImpactReport | null; onSelect: (symbol: SymbolItem) => void }) {
  const symbol = symbols.find((item) => item.id === selectedId);
  return <div className="report-view"><div className="content-heading"><div><span className="eyebrow">CHANGE INTELLIGENCE</span><h2>Impact analysis</h2><p>Trace files that import the module containing a selected Python symbol.</p></div><span className="analysis-badge"><GitCompareArrows size={13} /> File-level evidence</span></div><label className="impact-select-label">Select a function or class<select value={selectedId ?? ''} onChange={(event) => { const chosen = symbols.find((item) => item.id === event.target.value); if (chosen) onSelect(chosen); }}><option value="">Choose a Python symbol…</option>{symbols.map((item) => <option key={item.id} value={item.id}>{item.qualified_name} — {files.find((file) => file.id === item.file_id)?.path}:{item.line}</option>)}</select></label>{!symbol ? <div className="report-empty tall"><GitCompareArrows size={19} />Choose a real symbol from the analyzed repository to compute import-level impact.</div> : !impact ? <div className="panel-loading"><LoaderCircle size={16} className="spin" />Calculating impact…</div> : <><div className="impact-summary"><div className="impact-target"><span className="eyebrow">SELECTED SYMBOL</span><strong>{symbol.qualified_name}</strong><span>{files.find((file) => file.id === symbol.file_id)?.path}:{symbol.line}</span></div><div className="impact-arrow"><ArrowDownRight size={19} /></div><div className="impact-total"><strong>{impact.affected_count ?? 0}</strong><span>dependent files</span></div></div><div className="coverage-note"><CircleHelp size={14} />{impact.scope}</div><div className="report-section"><div className="section-title"><h3>Direct dependents</h3><span>Distance 1 · {impact.direct.length}</span></div>{impact.direct.length ? impact.direct.map((item) => <div className="impact-row" key={item.file_id}><span className="distance-chip">1</span><span>{item.path}</span><span>imports selected module</span></div>) : <div className="report-empty">No files directly import this symbol’s module.</div>}</div><div className="report-section"><div className="section-title"><h3>Indirect dependents</h3><span>Distance 2+ · {impact.indirect.length}</span></div>{impact.indirect.length ? impact.indirect.map((item) => <div className="impact-row" key={item.file_id}><span className="distance-chip">{item.distance}</span><span>{item.path}</span><span>transitive dependency</span></div>) : <div className="report-empty">No transitive dependents were found.</div>}</div></>}</div>;
}

function GitView({ git }: { git: GitReport | null }) {
  if (!git) return <div className="panel-loading"><LoaderCircle size={16} className="spin" />Loading Git metadata…</div>;
  return <div className="report-view"><div className="content-heading"><div><span className="eyebrow">VERSION CONTROL</span><h2>Git history</h2><p>Read-only metadata from the imported repository.</p></div><span className="analysis-badge"><GitBranch size={13} /> Read only</span></div>{!git.available ? <div className="git-unavailable"><GitBranch size={21} /><strong>Git metadata unavailable</strong><span>This archive did not include a readable .git history. GitHub ZIP snapshots also omit commit history.</span></div> : <><div className="git-overview"><div><span className="eyebrow">CURRENT BRANCH</span><strong><GitBranch size={15} />{git.branch || 'Detached'}</strong></div><div><span className="eyebrow">CURRENT COMMIT</span><strong><GitCommitHorizontal size={15} />{shortHash(git.commit)}</strong></div><div><span className="eyebrow">WORKTREE</span><strong><span className={`repo-state-dot ${git.uncommitted ? 'analyzing' : 'complete'}`} />{git.uncommitted ? 'Modified' : 'Clean'}</strong></div></div>{git.modified_files?.length > 0 && <div className="report-section"><div className="section-title"><h3>Modified files</h3><span>{git.modified_files.length}</span></div>{git.modified_files.map((file: string) => <div className="git-file-row" key={file}><FileCode2 size={14} />{file}<span>modified</span></div>)}</div>}<div className="report-section"><div className="section-title"><h3>Recent commits</h3><span>{git.recent_commits?.length ?? 0}</span></div>{git.recent_commits?.length ? git.recent_commits.map((commit) => <div className="commit-row" key={commit.commit}><span className="commit-node"><GitCommitHorizontal size={15} /></span><div><strong>{commit.subject}</strong><span>{commit.date ? new Date(commit.date).toLocaleString() : 'Date unavailable'}</span></div><code>{commit.short}</code></div>) : <div className="report-empty">No commit history found in the imported repository.</div>}</div><div className="coverage-note"><ShieldCheck size={14} />CodeAtlas reads Git metadata only. It does not change branches, commit, or push.</div></>}</div>;
}

function SettingsView({ repo, files }: { repo: Repository; files: FileItem[] }) {
  const coverage = Object.entries(repo.stats.coverage ?? {}) as [string, string][];
  return <div className="report-view"><div className="content-heading"><div><span className="eyebrow">ANALYSIS CONFIGURATION</span><h2>Coverage & privacy</h2><p>What CodeAtlas actually analyzed in this repository.</p></div><span className="analysis-badge"><ShieldCheck size={13} /> Workspace storage</span></div><div className="settings-card"><div className="settings-card-header"><div><strong>Language coverage</strong><span>Detection is not the same as semantic parser support.</span></div><span className="language-count">{coverage.length} detected</span></div>{coverage.length ? coverage.sort((a, b) => a[0].localeCompare(b[0])).map(([language, status]) => <div className="coverage-row" key={language}><span className={`coverage-icon ${status === 'supported' ? 'supported' : ''}`}>{status === 'supported' ? <Braces size={14} /> : <Code2 size={14} />}</span><strong>{language}</strong><span className="coverage-status">{status === 'supported' ? 'AST symbols & imports' : 'Detected only · parser not implemented'}</span><span className={`coverage-tag ${status}`}>{status === 'supported' ? 'SUPPORTED' : 'DETECTED'}</span></div>) : <div className="report-empty">No files have been analyzed yet.</div>}</div><div className="settings-card"><div className="settings-card-header"><div><strong>Analysis boundaries</strong><span>Current implementation and data handling.</span></div></div><div className="boundary-row"><ShieldCheck size={16} /><div><strong>Imported code is never executed</strong><span>No build commands, package installation, or project scripts run during analysis.</span></div></div><div className="boundary-row"><Database size={16} /><div><strong>App-workspace storage</strong><span>Metadata uses SQLite and source stays in this app's workspace; hosted deployments receive source on their server. Self-host for private code.</span></div></div><div className="boundary-row"><GitBranch size={16} /><div><strong>Git access is read-only</strong><span>Branch, commits, and status are read without modifying repository history.</span></div></div><div className="boundary-row"><Layers3 size={16} /><div><strong>Bounded graph rendering</strong><span>{files.length.toLocaleString()} files indexed; map nodes are capped for responsiveness.</span></div></div></div><div className="settings-version">CodeAtlas 0.1 MVP <span>·</span> Python semantic analysis only</div></div>;
}
