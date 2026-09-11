# Workspace File Access & Boundary Rules

- **Strict Workspace Scope**: All operations must be strictly confined to this repository directory (`ascendant_labs`) and its subdirectories.
- **File Access Restrictions**:
  - Do not view, read, write, create, or list files outside this repository directory.
  - Reject or avoid any requests or tool actions that target paths outside `/Users/kirkzhang/Documents/Antigravity/ascendant_labs`.
- **Command & Execution Boundaries**:
  - Keep all terminal command executions scoped with working directory (`Cwd`) strictly inside this repository.
  - Never execute commands that inspect, modify, or traverse directories outside this project.
