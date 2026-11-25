from collections import deque
import networkx as nx
from sqlalchemy import select
from sqlalchemy.orm import Session
from backend.database.models import Dependency, FileRecord


def import_graph(session: Session, repository_id: str) -> nx.DiGraph:
    graph = nx.DiGraph()
    files = session.scalars(select(FileRecord).where(FileRecord.repository_id == repository_id)).all()
    graph.add_nodes_from((item.id, {"path": item.path, "language": item.language, "kind": "file"}) for item in files)
    edges = session.scalars(
        select(Dependency).where(Dependency.repository_id == repository_id, Dependency.confidence == "confirmed", Dependency.target_id.is_not(None))
    ).all()
    for edge in edges:
        if edge.source_id in graph and edge.target_id in graph:
            graph.add_edge(edge.source_id, edge.target_id, kind=edge.kind, confidence=edge.confidence, detail=edge.detail)
    return graph


def dependency_report(session: Session, repository_id: str) -> dict:
    graph = import_graph(session, repository_id)
    components = [sorted(component) for component in nx.strongly_connected_components(graph) if len(component) > 1]
    self_cycles = [[node] for node in graph.nodes if graph.has_edge(node, node)]
    cycles = components + self_cycles
    node_meta = graph.nodes
    cycle_paths = [[node_meta[node].get("path", node) for node in cycle] for cycle in cycles]
    hubs = sorted(
        ({"path": data.get("path", node), "dependencies": int(graph.degree(node))} for node, data in graph.nodes(data=True)),
        key=lambda item: item["dependencies"], reverse=True,
    )[:10]
    isolated = [data.get("path", node) for node, data in graph.nodes(data=True) if graph.degree(node) == 0]
    return {
        "file_nodes": graph.number_of_nodes(), "confirmed_import_edges": graph.number_of_edges(),
        "cycle_count": len(cycles), "cycles": cycle_paths,
        "isolated_files": isolated[:100], "isolated_total": len(isolated),
        "highly_connected": hubs,
        "coverage_note": "Graph algorithms use confirmed in-repository Python import edges only; external and unresolved imports are excluded.",
    }


def impact_report(session: Session, repository_id: str, symbol_id: str) -> dict:
    from backend.database.models import Symbol
    symbol = session.get(Symbol, symbol_id)
    if not symbol or symbol.repository_id != repository_id:
        return {"found": False}
    graph = import_graph(session, repository_id)
    file_node = symbol.file_id
    if file_node not in graph:
        return {"found": True, "symbol": {"id": symbol.id, "name": symbol.qualified_name}, "file": symbol.file_id, "direct": [], "indirect": [], "scope": "No confirmed in-repository imports reach this file."}
    reverse = graph.reverse(copy=False)
    distances: dict[str, int] = {}
    queue = deque([(file_node, 0)])
    seen = {file_node}
    while queue:
        current, distance = queue.popleft()
        for dependent in reverse.successors(current):
            if dependent in seen:
                continue
            seen.add(dependent)
            distances[dependent] = distance + 1
            queue.append((dependent, distance + 1))
    records = []
    for file_id, distance in distances.items():
        records.append({"file_id": file_id, "path": graph.nodes[file_id].get("path", file_id), "distance": distance})
    records.sort(key=lambda item: (item["distance"], item["path"]))
    return {
        "found": True,
        "symbol": {"id": symbol.id, "name": symbol.qualified_name, "kind": symbol.kind, "line": symbol.line},
        "file": {"id": file_node, "path": graph.nodes[file_node].get("path")},
        "direct": [item for item in records if item["distance"] == 1],
        "indirect": [item for item in records if item["distance"] > 1],
        "affected_count": len(records),
        "scope": "Impact is inferred from confirmed file-level imports. Python call sites are not resolved in this release, so this is file/module impact rather than a guarantee that every listed file calls the selected symbol.",
    }
