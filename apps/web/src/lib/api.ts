import type { DependencyReport, FileItem, GitReport, GraphData, ImpactReport, Repository, SearchResult, SymbolItem } from '../types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.detail;
    throw new Error(typeof detail === 'string' ? detail : `Request failed (${response.status})`);
  }
  return body as T;
}

export async function listRepositories(): Promise<Repository[]> {
  const data = await request<{ items: Repository[] }>('/api/repositories');
  return data.items;
}

export async function getRepository(id: string): Promise<Repository> {
  return request(`/api/repositories/${encodeURIComponent(id)}`);
}

export async function importRepository(input: { file?: File; url?: string }): Promise<Repository> {
  const form = new FormData();
  if (input.file) form.set('file', input.file);
  if (input.url) form.set('repo_url', input.url);
  const data = await request<{ repository: Repository }>('/api/repositories/import', { method: 'POST', body: form });
  return data.repository;
}

export async function analyzeRepository(id: string): Promise<Repository> {
  const data = await request<{ repository: Repository }>(`/api/repositories/${encodeURIComponent(id)}/analyze`, { method: 'POST' });
  return data.repository;
}

export async function listFiles(id: string, options: { language?: string; directory?: string } = {}): Promise<FileItem[]> {
  const params = new URLSearchParams({ offset: '0', limit: '1000' });
  if (options.language) params.set('language', options.language);
  if (options.directory) params.set('directory', options.directory);
  const data = await request<{ items: FileItem[] }>(`/api/repositories/${encodeURIComponent(id)}/files?${params}`);
  return data.items;
}

export async function listSymbols(id: string): Promise<SymbolItem[]> {
  const data = await request<{ items: SymbolItem[] }>(`/api/repositories/${encodeURIComponent(id)}/symbols?offset=0&limit=1000`);
  return data.items;
}

export async function getGraph(id: string, options: { language?: string; directory?: string } = {}): Promise<GraphData> {
  const params = new URLSearchParams({ limit: '600' });
  if (options.language) params.set('language', options.language);
  if (options.directory) params.set('directory', options.directory);
  return request(`/api/repositories/${encodeURIComponent(id)}/graph?${params}`);
}

export async function getSource(id: string, fileId: string): Promise<{ path: string; language: string; content: string; truncated: boolean }> {
  return request(`/api/repositories/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}/content`);
}

export async function getDependencies(id: string): Promise<DependencyReport> {
  return request(`/api/repositories/${encodeURIComponent(id)}/dependencies`);
}

export async function getImpact(id: string, symbolId: string): Promise<ImpactReport> {
  return request(`/api/repositories/${encodeURIComponent(id)}/impact/${encodeURIComponent(symbolId)}`);
}

export async function getGit(id: string): Promise<GitReport> {
  return request(`/api/repositories/${encodeURIComponent(id)}/git/history`);
}

export async function searchRepository(id: string, query: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, limit: '50' });
  const data = await request<{ items: SearchResult[] }>(`/api/repositories/${encodeURIComponent(id)}/search?${params}`);
  return data.items;
}
