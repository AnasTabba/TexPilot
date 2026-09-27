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
	$(PIP) install -q -r requirements-ml.txt

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

api-scanner: ## The real scanner on this Mac, reachable from phones on the same wifi
	TEXPILOT_VISION=scanner TEXPILOT_GARMENT_DETECTOR=gdino TEXPILOT_OCR_BACKEND=apple \
	$(VENV)/bin/uvicorn services.api.main:app --host 0.0.0.0 --port 8000

check-data: ## Smoke-test TextileNet availability (spec risk #2)
	$(PY) scripts/check_textilenet.py $(ARGS)

clean:
	rm -rf $(VENV) .pytest_cache .ruff_cache **/__pycache__

.PHONY: help setup setup-ml setup-paddle test lint fmt api api-scanner check-data clean

PADDLE_VENV := .venv-paddle

setup-paddle: ## PaddleOCR in its own venv (its deps clash with the main ML stack)
	python3 -m venv $(PADDLE_VENV)
	$(PADDLE_VENV)/bin/pip install -q --upgrade pip
	$(PADDLE_VENV)/bin/pip install -q paddlepaddle==3.3.1 paddleocr==3.7.0
