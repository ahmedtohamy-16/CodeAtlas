import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImportDialog } from './ImportDialog';
import { TreeExplorer } from './TreeExplorer';
import type { FileItem } from '../types';

describe('ImportDialog', () => {
  it('validates a public GitHub URL before requesting an import', async () => {
    const onImport = vi.fn();
    render(<ImportDialog onImport={onImport} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Public repository URL'), { target: { value: 'http://example.com/private' } });
    fireEvent.click(screen.getByRole('button', { name: /import repository/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('public GitHub URL');
    expect(onImport).not.toHaveBeenCalled();
  });

  it('submits the chosen ZIP archive', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(<ImportDialog onImport={onImport} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('tab', { name: /zip archive/i }));
    const file = new File(['source'], 'project.zip', { type: 'application/zip' });
    fireEvent.change(screen.getByLabelText('Repository ZIP file'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /import repository/i }));
    await waitFor(() => expect(onImport).toHaveBeenCalledWith({ file }));
  });
});

describe('TreeExplorer', () => {
  it('filters files and navigates to a selected source file', () => {
    const files: FileItem[] = [
      { id: 'one', path: 'src/main.py', language: 'Python', extension: '.py', size_bytes: 20, line_count: 2, is_binary: false, oversized: false, parsed: true, parse_error: null },
      { id: 'two', path: 'tests/test_main.py', language: 'Python', extension: '.py', size_bytes: 30, line_count: 3, is_binary: false, oversized: false, parsed: true, parse_error: null },
    ];
    const onSelect = vi.fn();
    render(<TreeExplorer files={files} onSelect={onSelect} />);
    fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'src/main.py' } });
    fireEvent.click(screen.getByTitle('src/main.py'));
    expect(onSelect).toHaveBeenCalledWith(files[0]);
    expect(screen.queryByTitle('tests/test_main.py')).not.toBeInTheDocument();
  });
});
