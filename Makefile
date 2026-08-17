.PHONY: up down dev logs test seed psql reset build help

## Start all services (postgres + api)
up:
	docker compose up -d
	@echo "\n✅  Services up → http://localhost:3000"

## Start with pgAdmin (dev only)
dev:
	docker compose --profile dev up -d
	@echo "\n✅  Services up"
	@echo "   API:     http://localhost:3000"
	@echo "   pgAdmin: http://localhost:5050"

## Stop all services
down:
	docker compose down

## Stop and remove volumes (full reset)
reset:
	docker compose down -v
	@echo "⚠️  Database wiped"

## View API logs
logs:
	docker compose logs -f api

## View postgres logs
logs-db:
	docker compose logs -f postgres

## Run test suite (against running server)
test:
	SERVER_URL=http://localhost:3000 ADMIN_API_KEY=$(shell grep ADMIN_API_KEY .env | cut -d= -f2) node scripts/test.js

## Seed demo providers + endpoints
seed:
	DATABASE_URL=$(shell grep DATABASE_URL .env | cut -d= -f2) node scripts/seed.js

## Open psql shell
psql:
	docker compose exec postgres psql -U $(shell grep POSTGRES_USER .env | cut -d= -f2) $(shell grep POSTGRES_DB .env | cut -d= -f2)

## Rebuild the API image
build:
	docker compose build api

## Tail proxy call log (paid requests)
watch:
	docker compose logs -f api | grep "💳"

## Print help
help:
	@echo ""
	@echo "MAMMBA x402 Marketplace"
	@echo "─────────────────────────────────"
	@grep -E '^## ' Makefile | sed 's/## //'
	@echo ""
