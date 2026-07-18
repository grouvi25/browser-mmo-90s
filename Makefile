.PHONY: dev build db-migrate db-seed db-reset logs deploy help

help:
	@echo "Available commands:"
	@echo "  make dev          - Start in development mode"
	@echo "  make build        - Build production Docker images"
	@echo "  make db-migrate   - Run Prisma migrations"
	@echo "  make db-seed      - Seed the database"
	@echo "  make db-reset     - Reset database (DANGER!)"
	@echo "  make logs         - Show container logs"
	@echo "  make deploy       - Deploy to VPS"

dev:
	docker compose up -d postgres redis
	cd backend && npm run dev &
	cd frontend && npm run dev

build:
	docker compose build

db-migrate:
	cd backend && npx prisma migrate deploy

db-seed:
	cd backend && npx prisma db seed

db-reset:
	cd backend && npx prisma migrate reset --force

logs:
	docker compose logs -f

deploy:
	bash infra/deploy/deploy.sh
