import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SourcePane } from './SourcePane';
import { SearchDialog } from './SearchDialog';
import type { Repository } from '../types';

const { getSourceMock, searchMock } = vi.hoisted(() => ({ getSourceMock: vi.fn(), searchMock: vi.fn() }));
vi.mock('../lib/api', () => ({ getSource: getSourceMock, searchRepository: searchMock }));

const repo: Repository = { id: 'repo-1', name: 'fixture', source: 'zip', imported_at: '', last_analyzed: '', status: 'complete', progress: 100, progress_message: 'Complete', error: null, stats: {}, current_branch: null, current_commit: null };
const file = { id: 'file-1', path: 'src/main.py', language: 'Python', extension: '.py', size_bytes: 40, line_count: 3, is_binary: false, oversized: false, parsed: true, parse_error: null };

beforeEach(() => { getSourceMock.mockReset(); searchMock.mockReset(); });

describe('SourcePane', () => {
  it('shows read-only source and line numbers', async () => {
    getSourceMock.mockResolvedValue({ path: file.path, language: 'Python', content: 'def greet():\n    return "hi"\n', truncated: false });
    render(<SourcePane repo={repo} file={file} symbol={null} />);
    const pane = await screen.findByRole('region', { name: 'Read-only source viewer' });
    expect(pane).toHaveTextContent('def greet():');
    expect(pane.querySelector('.line-number:nth-child(1)')).toHaveTextContent('1');
    expect(pane.querySelectorAll('.line-number')[1]).toHaveTextContent('2');
  });

  it('renders source load errors as an explicit error state', async () => {
    getSourceMock.mockRejectedValue(new Error('Source unavailable'));
    render(<SourcePane repo={repo} file={file} symbol={null} />);
    expect(await screen.findByText('Source unavailable')).toBeInTheDocument();
  });
});

describe('SearchDialog', () => {
  it('searches repository symbols and navigates to the selected result', async () => {
    searchMock.mockResolvedValue([{ id: 'sym-1', type: 'function', name: 'greet', path: 'src/main.py', line: 4, file_id: 'file-1' }]);
    const onSelect = vi.fn();
    render(<SearchDialog repo={repo} onClose={() => undefined} onSelect={onSelect} />);
    fireEvent.change(screen.getByPlaceholderText(/search files/i), { target: { value: 'greet' } });
    const result = await screen.findByRole('button', { name: /greet/ });
    fireEvent.click(result);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'sym-1', path: 'src/main.py' })));
  });
});
