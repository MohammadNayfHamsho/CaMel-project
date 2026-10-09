from camel.interpreter import interpreter
from camel.interpreter import namespace as ns

try:
    eval_args = interpreter.EvalArgs(None, interpreter.MetadataEvalMode.NORMAL)
    res, _, _, _ = interpreter.parse_and_interpret_code("print('mock response')", ns.Namespace.with_builtins(), [], (), eval_args)
    print("Result:", res)
except Exception as e:
    print("Exception:", type(e), e)
