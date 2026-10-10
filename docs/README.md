# CaMeL documentation

These guides describe this checkout, including its JavaScript migration. The Python interpreter's security mechanism and the JavaScript runner's Semgrep scan are different implementations.

- [Original project overview](original-overview.md): the first explanation from the conversation, preserved as a historical snapshot.
- [Policies and enforcement](policies-and-enforcement.md): what a policy means and exactly what happens before a rejected sink executes.
- [Interpreter and taint tracking](interpreter-and-taint.md): runtime value dependencies, sources, readers, and evaluation modes.
- [Tools](tools.md): all registered AgentDojo v1.2 tools in the installed suites, Python builtins, and supported methods.
- [Glossary](glossary.md): the main terms used in the project.
- [JavaScript and Semgrep](javascript-and-semgrep.md): the current execution path and its limitations.

Read the original overview first, then the interpreter guide and policy guide. Source links in these guides are relative to the repository; search for the named function when investigating implementation details.

The original overview predates the Semgrep integration. Its description of the JavaScript runner as having no scan is historical. The current runner performs a static scan, but still does not implement Python's dynamic capabilities or policy enforcement.
