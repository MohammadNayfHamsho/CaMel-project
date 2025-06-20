# `CaMeL`: Defeating Prompt Injections by Design

Edoardo Debenedetti<sup>1,3</sup>, Ilia Shumailov<sup>2</sup>, Tianqi Fan<sup>1</sup>, Jamie Hayes<sup>2</sup>, Nicholas Carlini<sup>2</sup>, Daniel Fabian<sup>1</sup>, Christoph Kern<sup>1</sup>, Chongyang Shi<sup>2</sup>, Florian Tramèr<sup>3</sup>

<sup>1</sup>Google, <sup>2</sup>Google DeepMind, and <sup>3</sup>ETH Zurich

> [!WARNING]
> This is a research artifact released to reproduce the results in our paper. The interpreter implementation likely contains bugs (e.g., it might throw uncaught exceptions and crash) and the implementation might not be fully secure.
>
> This is **not** a Google product, and we are not planning to provide support for and/or maintain this codebase.

## Pre-requisites

Install `uv` via the [official instructions](https://docs.astral.sh/uv/getting-started/installation/)

## Running running the defense against AgentDojo

```bash
uv run --env-file .env main.py MODEL_NAME [--use-original] [--ad_defense] [--reasoning-effort] [--thinking_budget_tokens] [--run-attack] [--replay-with-policies] [--eval_mode]
```

More details on the various CLI arguments can be found by running `uv run main.py --help`

## Running tests and linters

```bash
uv run ruff check --fix
uv run format
uv run pyright
uv run pytest
```

This is not an officially supported Google product. This project is not
eligible for the [Google Open Source Software Vulnerability Rewards
Program](https://bughunters.google.com/open-source-security).
