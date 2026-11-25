import io
import json
import re
import shutil
import stat
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
MAX_EXPANDED_BYTES = 250 * 1024 * 1024
MAX_MEMBERS = 50_000
MAX_MEMBER_BYTES = 20 * 1024 * 1024
GITHUB_REPO = re.compile(r"^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$")
ALLOWED_REDIRECT_HOSTS = {"api.github.com", "github.com", "codeload.github.com"}


class ImportErrorSafe(ValueError):
    pass


class _GitHubRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        host = urllib.parse.urlparse(new_url).hostname
        if host not in ALLOWED_REDIRECT_HOSTS:
            raise ImportErrorSafe("GitHub redirected to an unexpected host")
        return super().redirect_request(request, fp, code, message, headers, new_url)


def _download(url: str, limit: int) -> bytes:
    opener = urllib.request.build_opener(_GitHubRedirect())
    request = urllib.request.Request(url, headers={"User-Agent": "CodeAtlas/0.1", "Accept": "application/vnd.github+json"})
    try:
        with opener.open(request, timeout=20) as response:
            final = urllib.parse.urlparse(response.geturl())
            if final.scheme != "https" or final.hostname not in ALLOWED_REDIRECT_HOSTS:
                raise ImportErrorSafe("Download ended at an unexpected host")
            declared = response.headers.get("Content-Length")
            if declared and int(declared) > limit:
                raise ImportErrorSafe("Archive exceeds the 100 MB download limit")
            data = response.read(limit + 1)
            if len(data) > limit:
                raise ImportErrorSafe("Archive exceeds the 100 MB download limit")
            return data
    except ImportErrorSafe:
        raise
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise ImportErrorSafe(f"Could not download the public GitHub repository: {exc}") from exc


def github_archive(url: str) -> tuple[bytes, str]:
    match = GITHUB_REPO.fullmatch(url.strip())
    parsed = urllib.parse.urlparse(url.strip())
    if not match or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ImportErrorSafe("Enter a public GitHub repository URL such as https://github.com/owner/repository")
    owner, repo = match.groups()
    repo = repo.removesuffix(".git")
    api_url = f"https://api.github.com/repos/{urllib.parse.quote(owner)}/{urllib.parse.quote(repo)}"
    metadata = _download(api_url, 2 * 1024 * 1024)
    try:
        branch = json.loads(metadata).get("default_branch")
    except (json.JSONDecodeError, AttributeError) as exc:
        raise ImportErrorSafe("GitHub returned repository metadata in an unexpected format") from exc
    if not branch or len(branch) > 255:
        raise ImportErrorSafe("GitHub did not provide a valid default branch")
    archive_url = f"https://api.github.com/repos/{urllib.parse.quote(owner)}/{urllib.parse.quote(repo)}/zipball/{urllib.parse.quote(branch, safe='')}"
    return _download(archive_url, MAX_ARCHIVE_BYTES), repo


def safe_extract_zip(data: bytes, destination: Path) -> Path:
    if len(data) > MAX_ARCHIVE_BYTES:
        raise ImportErrorSafe("ZIP upload exceeds the 100 MB limit")
    destination = destination.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, OSError) as exc:
        raise ImportErrorSafe("The uploaded file is not a valid ZIP archive") from exc

    with archive:
        members = archive.infolist()
        if len(members) > MAX_MEMBERS:
            raise ImportErrorSafe("ZIP archive has too many entries")
        expanded = sum(info.file_size for info in members)
        if expanded > MAX_EXPANDED_BYTES:
            raise ImportErrorSafe("ZIP expands beyond the 250 MB extraction limit")
        if expanded and expanded / max(len(data), 1) > 500:
            raise ImportErrorSafe("ZIP compression ratio is excessive")
        valid_roots = []
        normalized = []
        for info in members:
            raw = info.filename.replace("\\", "/")
            relative = PurePosixPath(raw)
            mode = info.external_attr >> 16
            if relative.is_absolute() or any(part in ("..", "") for part in relative.parts) or "\x00" in raw:
                raise ImportErrorSafe("ZIP contains an unsafe path")
            if stat.S_ISLNK(mode):
                raise ImportErrorSafe("ZIP symbolic links are not accepted")
            if info.file_size > MAX_MEMBER_BYTES:
                raise ImportErrorSafe("A ZIP entry exceeds the 20 MB per-file limit")
            if not relative.parts or relative.parts[0].endswith(":"):
                raise ImportErrorSafe("ZIP contains an invalid path")
            normalized.append((info, relative))
            if not info.is_dir():
                valid_roots.append(relative.parts[0])
        common_root = valid_roots[0] if valid_roots and all(item == valid_roots[0] for item in valid_roots) and all(len(path.parts) > 1 for info, path in normalized if not info.is_dir()) else None
        written = 0
        for info, relative in normalized:
            parts = relative.parts[1:] if common_root else relative.parts
            if not parts:
                continue
            target = (destination / Path(*parts)).resolve()
            if not target.is_relative_to(destination):
                raise ImportErrorSafe("ZIP path escapes the repository directory")
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as source, target.open("wb") as output:
                while chunk := source.read(1024 * 1024):
                    written += len(chunk)
                    if written > MAX_EXPANDED_BYTES:
                        raise ImportErrorSafe("ZIP extraction exceeded the configured limit")
                    output.write(chunk)

    if not any(path.is_file() for path in destination.rglob("*")):
        shutil.rmtree(destination, ignore_errors=True)
        raise ImportErrorSafe("The ZIP archive contains no files")
    return destination
