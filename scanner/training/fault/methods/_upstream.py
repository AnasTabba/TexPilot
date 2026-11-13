"""Scope legacy upstream absolute imports to their checkout, without leaking module names.

All callers using these repositories must share this context (including runtime imports).
This serializes cooperating wrappers, not arbitrary third-party imports in other threads.
"""
import sys
from contextlib import contextmanager
from pathlib import Path
from threading import RLock

_LOCK = RLock()
_MODULES = {}
_ACTIVE = []
# Shared legacy roots, including encoder dependencies imported by vit_encoder.
_ROOTS = frozenset(('models', 'utils', 'optimizers', 'dataset', 'datasets', 'dinov1',
                    'dinov2', 'beit', 'aug_funcs', 'flops_profiler'))


def _owned(name):
    return name.split('.', 1)[0] in _ROOTS


@contextmanager
def upstream_repo(repo_dir):
    """Temporarily activate and retain a checkout's legacy modules; restore on errors too."""
    repo = str(Path(repo_dir).resolve())
    with _LOCK:
        if _ACTIVE and _ACTIVE[-1] == repo:
            yield
            return
        previous = {k: v for k, v in sys.modules.items() if _owned(k)}
        if _ACTIVE:
            _MODULES[_ACTIVE[-1]] = previous
        path = sys.path[:]
        for name in previous:
            del sys.modules[name]
        sys.modules.update(_MODULES.get(repo, {}))
        sys.path.insert(0, repo)
        _ACTIVE.append(repo)
        try:
            yield
        finally:
            current = {k: v for k, v in sys.modules.items() if _owned(k)}
            _MODULES[repo] = current
            for name in current:
                del sys.modules[name]
            sys.modules.update(previous)
            sys.path[:] = path
            _ACTIVE.pop()
