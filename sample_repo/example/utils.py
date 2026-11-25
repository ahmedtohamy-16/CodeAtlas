from . import service


def normalize_name(value: str) -> str:
    """Normalize a display name without mutating external state."""
    return " ".join(value.strip().split()).title()


def greeting_type() -> str:
    return service.Greeter.__name__
