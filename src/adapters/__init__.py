"""Provider-specific adapters sharing the ScanResult contract."""
from .base import HistoryAdapter, ScanResult
from .jsonl import CodexAdapter, ClaudeAdapter
from .antigravity import AntigravityAdapter
from .copilot import CopilotAdapter
from .cursor import CursorAdapter
from .grok import GrokAdapter
from .opencode import OpenCodeAdapter


def create_adapters(roots=None) -> list[HistoryAdapter]:
    if roots is not None:
        grouped = {}
        for provider, root in roots:
            grouped.setdefault(provider, []).append(root)
        factories = {'codex': CodexAdapter, 'claude': ClaudeAdapter}
        return [factories[provider](paths) for provider, paths in grouped.items()]
    return [CodexAdapter(), ClaudeAdapter(), AntigravityAdapter(), CopilotAdapter(), CursorAdapter(), GrokAdapter(), OpenCodeAdapter()]
