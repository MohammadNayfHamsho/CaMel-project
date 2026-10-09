import subprocess
import re
import dataclasses
from enum import Enum
import pydantic
from typing import Any, Generic, TypeVar
from camel.interpreter import result

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
    def __init__(self, exception, nodes=None):
        self.exception = exception
        self.nodes = nodes or [MockNode()]

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

def parse_and_interpret_code(code: str, namespace, dummy1, dependencies, eval_args):
    try:
        extracted = extract_code_block(code)
    except InvalidOutputError as e:
        camel_ex = CaMeLException(e, [MockNode()])
        return result.Error(camel_ex), namespace, [], dependencies

    try:
        proc = subprocess.run(["node", "-e", extracted], capture_output=True, text=True, timeout=10)
        if proc.returncode != 0:
            ex = Exception(proc.stderr.strip() or "Node.js execution failed")
            camel_ex = CaMeLException(ex, [MockNode()])
            return result.Error(camel_ex), namespace, [], dependencies
        else:
            return result.Ok(MockResult(proc.stdout.strip())), namespace, [], dependencies
    except Exception as e:
        camel_ex = CaMeLException(e, [MockNode()])
        return result.Error(camel_ex), namespace, [], dependencies
