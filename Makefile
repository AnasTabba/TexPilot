.DEFAULT_GOAL := help
VENV := .venv
PY   := $(VENV)/bin/python
PIP  := $(VENV)/bin/pip

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

$(VENV):
	python3 -m venv $(VENV)

setup: $(VENV) ## Install core + dev deps (fast, no torch)
	$(PIP) install -q --upgrade pip
	$(PIP) install -q -e ".[dev]"
	@echo "Ready. Run 'make test' then 'make api'."

setup-ml: setup ## Additionally install the ML stack (large download)
	$(PIP) install -q -e ".[ml]"

test: ## Run the test suite
	$(VENV)/bin/pytest

lint: ## Lint and check formatting
	$(VENV)/bin/ruff check .
	$(VENV)/bin/ruff format --check .

fmt: ## Auto-format
	$(VENV)/bin/ruff format .
	$(VENV)/bin/ruff check --fix .

api: ## Run the API at http://127.0.0.1:8000 (docs at /docs)
	$(VENV)/bin/uvicorn services.api.main:app --reload --port 8000

api-lan: ## Run the API on your LAN so a phone on the same wifi can reach it
	$(VENV)/bin/uvicorn services.api.main:app --reload --host 0.0.0.0 --port 8000

app-setup: ## Install the app's JS dependencies
	cd app && npm ci

app: ## Start the Expo dev server for the app (scan the QR code with Expo Go)
	cd app && npx expo start

app-check: ## Typecheck, lint, format-check and test the app
	cd app && npm run check

check-data: ## Smoke-test TextileNet availability (spec risk #2)
	$(PY) scripts/check_textilenet.py $(ARGS)

clean:
	rm -rf $(VENV) .pytest_cache .ruff_cache **/__pycache__

.PHONY: help setup setup-ml test lint fmt api api-lan app-setup app app-check check-data clean
