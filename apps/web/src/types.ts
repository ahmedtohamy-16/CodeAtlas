export type Repository = {
  id: string;
  name: string;
  source: 'zip' | 'github';
  imported_at: string;
  last_analyzed: string | null;
  status: 'queued' | 'analyzing' | 'complete' | 'failed';
  progress: number;
  progress_message: string;
  error: string | null;
  stats: {
    file_count?: number;
    symbol_count?: number;
    imports_confirmed?: number;
    languages?: Record<string, number>;
    coverage?: Record<string, string>;
    [key: string]: unknown;
  };
  current_branch: string | null;
  current_commit: string | null;
};

export type FileItem = {
  id: string;
  path: string;
  language: string;
  extension: string;
  size_bytes: number;
  line_count: number | null;
  is_binary: boolean;
  oversized: boolean;
  parsed: boolean;
  parse_error: string | null;
};

export type SymbolItem = {
  id: string;
  file_id: string;
  name: string;
  qualified_name: string;
  kind: string;
  line: number;
  end_line: number;
  docstring: string | null;
  source_preview: string | null;
};

export type GraphNode = {
  id: string;
  name: string;
  path: string;
  kind: string;
  language: string;
  file_id?: string;
  line?: number | null;
  size?: number;
  qualified_name?: string;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: string;
  confidence: string;
  label?: string;
};

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  node_limit: number;
  total_files: number;
  total_symbols: number;
};

export type SearchResult = {
  id: string;
  type: string;
  name: string;
  path: string;
  line: number | null;
  file_id: string;
};

export type DependencyReport = {
  file_nodes: number;
  confirmed_import_edges: number;
  cycle_count: number;
  cycles: string[][];
  isolated_files: string[];
  isolated_total: number;
  highly_connected: { path: string; dependencies: number }[];
  coverage_note: string;
  imports: { id: string; source: string; target: string | null; kind: string; confidence: string; detail: string; line: number | null }[];
  imports_truncated: boolean;
};

export type ImpactReport = {
  found: boolean;
  symbol?: { id: string; name: string; kind: string; line: number };
  file?: { id: string; path: string };
  direct: { file_id: string; path: string; distance: number }[];
  indirect: { file_id: string; path: string; distance: number }[];
  affected_count?: number;
  scope: string;
};

export type GitCommit = { commit: string; short: string; subject: string; date: string };

export type GitReport = {
  available: boolean;
  branch: string | null;
  commit: string | null;
  recent_commits: GitCommit[];
  modified_files: string[];
  uncommitted: boolean;
};
