import ast
import hashlib
from dataclasses import dataclass
from typing import Any


@dataclass
class ParsedSymbol:
    name: str
    qualified_name: str
    kind: str
    line: int
    end_line: int
    docstring: str | None
    source_preview: str


@dataclass
class ParsedImport:
    module: str | None
    level: int
    names: list[str]
    line: int
    statement: str


@dataclass
class ParseResult:
    symbols: list[ParsedSymbol]
    imports: list[ParsedImport]
    syntax_error: str | None = None


def stable_id(*parts: Any) -> str:
    payload = "\x1f".join(str(part) for part in parts)
    return hashlib.sha256(payload.encode("utf-8", "replace")).hexdigest()[:32]


def _source(node: ast.AST, content: str) -> str:
    try:
        snippet = ast.get_source_segment(content, node) or ""
    except (TypeError, ValueError):
        snippet = ""
    return snippet[:1800]


def _symbol(node: ast.AST, content: str, name: str, qualified: str, kind: str) -> ParsedSymbol:
    doc = ast.get_docstring(node) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Module)) else None
    return ParsedSymbol(
        name=name,
        qualified_name=qualified,
        kind=kind,
        line=getattr(node, "lineno", 1),
        end_line=getattr(node, "end_lineno", getattr(node, "lineno", 1)),
        docstring=doc[:1000] if doc else None,
        source_preview=_source(node, content),
    )


def parse_python(content: str) -> ParseResult:
    try:
        tree = ast.parse(content)
    except (SyntaxError, ValueError, TypeError) as exc:
        line = getattr(exc, "lineno", None)
        message = getattr(exc, "msg", None) or str(exc)
        return ParseResult([], [], f"Line {line}: {message}" if line else message)

    symbols: list[ParsedSymbol] = []
    imports: list[ParsedImport] = []

    def visit_node(node: ast.AST, parent: str = "") -> None:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            qualified = f"{parent}.{node.name}" if parent else node.name
            symbols.append(_symbol(node, content, node.name, qualified, "function" if not parent else "method"))
            for child in node.body:
                visit_node(child, qualified)
        elif isinstance(node, ast.ClassDef):
            qualified = f"{parent}.{node.name}" if parent else node.name
            symbols.append(_symbol(node, content, node.name, qualified, "class"))
            for child in node.body:
                visit_node(child, qualified)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(ParsedImport(alias.name, 0, [], node.lineno, f"import {alias.name}"))
        elif isinstance(node, ast.ImportFrom):
            names = [alias.name for alias in node.names]
            module_text = "." * node.level + (node.module or "")
            imports.append(ParsedImport(node.module, node.level, names, node.lineno, f"from {module_text} import {', '.join(names)}"))
        else:
            for child in ast.iter_child_nodes(node):
                visit_node(child, parent)

    for node in tree.body:
        visit_node(node)
    return ParseResult(symbols, imports)
