import { useRef, useState, type FormEvent } from 'react';
import { Archive, ArrowUpRight, Github, LoaderCircle, X } from 'lucide-react';

export function ImportDialog({ onImport, onClose }: { onImport: (input: { file?: File; url?: string }) => Promise<void>; onClose: () => void }) {
  const [mode, setMode] = useState<'github' | 'zip'>('github');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (mode === 'github' && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(url.trim().replace(/\.git$/, ''))) {
      setError('Enter a public GitHub URL, for example https://github.com/owner/repository');
      return;
    }
    if (mode === 'zip' && !file) {
      setError('Choose a ZIP archive first.');
      return;
    }
    if (file && file.size > 100 * 1024 * 1024) {
      setError('ZIP archives are limited to 100 MB.');
      return;
    }
    setBusy(true);
    try {
      await onImport(mode === 'github' ? { url: url.trim() } : { file: file ?? undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="modal-heading">
          <div><span className="eyebrow">NEW WORKSPACE</span><h2 id="import-title">Open a repository</h2><p>Bring in a codebase to map its real structure and dependencies.</p></div>
          <button className="icon-button" aria-label="Close import dialog" onClick={onClose} disabled={busy}><X size={17} /></button>
        </div>
        <div className="import-tabs" role="tablist" aria-label="Import source">
          <button className={mode === 'github' ? 'import-tab active' : 'import-tab'} role="tab" aria-selected={mode === 'github'} onClick={() => setMode('github')}><Github size={15} /> GitHub URL</button>
          <button className={mode === 'zip' ? 'import-tab active' : 'import-tab'} role="tab" aria-selected={mode === 'zip'} onClick={() => setMode('zip')}><Archive size={15} /> ZIP archive</button>
        </div>
        <form onSubmit={submit}>
          {mode === 'github' ? <label className="field-label">Public repository URL<input autoFocus value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/owner/repository" autoComplete="url" /></label> : <div className="field-label">Repository archive
            <button type="button" className="drop-zone" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setFile(event.dataTransfer.files[0] ?? null); }}>
              <Archive size={20} />
              <span>{file ? file.name : 'Choose a .zip file or drop it here'}</span>
              <small>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : 'Maximum 100 MB · no project code is executed'}</small>
            </button>
            <input ref={inputRef} className="visually-hidden" type="file" accept=".zip,application/zip" aria-label="Repository ZIP file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </div>}
          {error && <div className="inline-error" role="alert">{error}</div>}
          <div className="privacy-note"><span className="status-dot green" /> ZIP/GitHub source is transferred to this app’s analysis workspace; it is never sent to an external analysis service or executed.</div>
          <div className="modal-actions"><button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={15} /> Importing…</> : <>Import repository <ArrowUpRight size={15} /></>}</button></div>
        </form>
      </section>
    </div>
  );
}
