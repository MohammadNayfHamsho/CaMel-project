import subprocess
import re
import dataclasses
import json
import tempfile
from pathlib import Path
from enum import Enum
import pydantic
from typing import Any, Generic, TypeVar
from camel.interpreter import result
from camel.capabilities import Capabilities, readers, sources

_T = TypeVar("_T")

class MetadataEvalMode(Enum):
    NORMAL = 1
    STRICT = 2

@dataclasses.dataclass
class EvalArgs:
    security_policy_engine: Any
    eval_mode: MetadataEvalMode

class InvalidOutputError(Exception):
    pass

class MockNode:
    lineno = 1
    col_offset = 0

class CaMeLException(Exception):
    def __init__(self, exception, nodes=None, dependencies=(), metadata=None):
        super().__init__(str(exception))
        self.exception = exception
        self.nodes = nodes or [MockNode()]
        self.dependencies = tuple(dependencies)
        self.metadata = metadata if metadata is not None else Capabilities.camel()

    def get_dependencies(self, visited_objects=frozenset()):
        return self.dependencies, visited_objects | {id(self)}

class FunctionCall(pydantic.BaseModel, Generic[_T]):
    model_config = pydantic.ConfigDict(arbitrary_types_allowed=True)
    function: str
    args: dict[str, Any]
    output: Any = None
    is_builtin: bool = False

class MockResult:
    def __init__(self, raw):
        self.raw = raw

def extract_code_block(text: str) -> str:
    pattern = r"```(?:javascript|js|node)\n(.*?)```"
    match = re.search(pattern, text, re.DOTALL)
    if match:
        return match.group(1).strip()
        
    pattern_general = r"```\n(.*?)```"
    match_general = re.search(pattern_general, text, re.DOTALL)
    if match_general:
        return match_general.group(1).strip()
        
    raise InvalidOutputError("You must provide exactly one non-empty code block in markdown format.")


def _wsl_path(path: Path) -> str:
    """Translate a local Windows drive path for WSL's default /mnt mounts."""
    resolved = path.resolve()
    if resolved.drive:
        return f"/mnt/{resolved.drive[0].lower()}/{resolved.as_posix()[3:]}"
    return resolved.as_posix()


def scan_javascript(code: str) -> None:
    """Print Semgrep JSON before execution; findings are informational for now."""
    rules = Path(__file__).with_name("semgrep_rules.yaml")
    # Keep the target on the same Windows drive as the rules so WSL can read it.
    with tempfile.TemporaryDirectory(prefix="camel-semgrep-", dir=rules.parent) as directory:
        target = Path(directory) / "generated.js"
        target.write_text(code, encoding="utf-8")
        scan = subprocess.run(
            [
                "wsl", "/home/max/miniconda3/bin/semgrep", "scan", "--config", _wsl_path(rules),
                "--json", "--quiet", "--metrics=off", "--disable-version-check",
                "--no-git-ignore", _wsl_path(target),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
        if scan.stdout.strip():
            print(scan.stdout, flush=True)
        if scan.returncode != 0:
            raise RuntimeError(
                f"Semgrep scan failed (exit {scan.returncode}): {scan.stderr.strip()}"
            )
        # An empty or malformed report is a scan failure, not a successful scan.
        json.loads(scan.stdout)

def parse_and_interpret_code(code: str, namespace, dummy1, dependencies, eval_args):
    try:
        extracted = extract_code_block(code)
    except InvalidOutputError as e:
        camel_ex = CaMeLException(e, [MockNode()])
        return result.Error(camel_ex), namespace, [], dependencies

    try:
        scan_javascript(extracted)
        proc = subprocess.run(["node", "-e", extracted], capture_output=True, text=True, timeout=10)
        if proc.returncode != 0:
            ex = Exception(proc.stderr.strip() or "Node.js execution failed")
            camel_ex = CaMeLException(
                ex, [MockNode()],
                metadata=Capabilities(frozenset({sources.Tool("node")}), readers.Public()),
            )
            return result.Error(camel_ex), namespace, [], dependencies
        else:
            return result.Ok(MockResult(proc.stdout.strip())), namespace, [], dependencies
    except Exception as e:
        camel_ex = CaMeLException(e, [MockNode()])
        return result.Error(camel_ex), namespace, [], dependencies
