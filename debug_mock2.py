from camel.interpreter import interpreter
from camel.interpreter import namespace as ns

eval_args = interpreter.EvalArgs(None, interpreter.MetadataEvalMode.NORMAL)
res, _, _, _ = interpreter.parse_and_interpret_code("```python\nprint('mock response')\n```", ns.Namespace.with_builtins(), [], (), eval_args)
print(res)
