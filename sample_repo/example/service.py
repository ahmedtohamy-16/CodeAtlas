from .utils import normalize_name


def greet(name: str) -> str:
    """Return a normalized greeting."""
    return f"Hello, {normalize_name(name)}!"


class Greeter:
    def __init__(self, prefix: str = "Hello") -> None:
        self.prefix = prefix

    def render(self, name: str) -> str:
        return f"{self.prefix}, {normalize_name(name)}!"
