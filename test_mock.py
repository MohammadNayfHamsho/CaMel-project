from camel.models import make_tools_pipeline
from camel.interpreter.interpreter import MetadataEvalMode
from agentdojo.default_suites.v1.workspace.task_suite import WorkspaceEnvironment
from agentdojo import functions_runtime
import os

os.environ["OPENAI_API_KEY"] = "mock"
pipeline = make_tools_pipeline(
    model="mock:mock-model",
    use_original=False,
    replay_with_policies=False,
    attack_name="mock-attack",
    reasoning_effort="low",
    thinking_budget_tokens=None,
    suite="workspace",
    ad_defense=None,
    eval_mode=MetadataEvalMode.NORMAL,
    q_llm="mock:mock-model"
)

runtime = functions_runtime.FunctionsRuntime()
env = WorkspaceEnvironment()

print(pipeline.name)
try:
    print(pipeline.query("mock query", runtime=runtime, env=env, messages=[]))
except Exception as e:
    print(f"Failed: {e}")
