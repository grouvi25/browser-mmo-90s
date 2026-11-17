# Горячий резерв Кооператива

Основной сервер: Aeza 82.148.244.248. Резерв: Beget 85.198.67.48. С 17.11.2026.

## Как устроено

- **База.** Потоковая репликация Postgres: каждое изменение на основном через доли секунды
  есть на резерве. Слот `beget_slot` держит WAL, если резерв отстал (не больше 2 ГБ,
  `max_slot_wal_keep_size`), роль `replicator`.
- **Redis** (сессии игроков, состояние боёв) — копия основного (`--replicaof`).
- **Связь.** На основном контейнеры `koop-repl-pg` и `koop-repl-redis` (alpine/socat в сети
  `mmo90s_network`) открывают базу и Redis только на 127.0.0.1:15432 и :16379. Резерв ходит
  к ним SSH-туннелем `koop-tunnel.service` (ключ `/root/.ssh/koop_tunnel`, на основном
  ограничен `permitopen` на эти два порта, команды запрещены). На резерве туннель слушает
  172.17.0.1, контейнеры видят его как `host.docker.internal`.
- **Версия игры.** Автовыкатка после выката на основной отдаёт те же образы и коммит
  на резерв (`standby-gate.sh`, команды `load` и `stage`). Игра на резерве не запущена,
  работают только `postgres` и `redis` с `docker-compose.standby.yml`.
- **nginx и сертификаты.** `refresh-certs.sh` достаёт сертификаты из последнего архива
  бэкапа основного (`/srv/backups/aeza`) и готовит сайты в `sites-available`, не включая.

## Проверить, что резерв живой

На основном:

    docker exec mmo90s-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select state, replay_lag from pg_stat_replication"'
    docker exec mmo90s-redis-1 redis-cli info replication | grep connected_slaves

На резерве:

    docker exec mmo90s-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select pg_is_in_recovery(), now()-pg_last_xact_replay_timestamp()"'
    docker exec mmo90s-redis-1 redis-cli info replication | grep link_status

## Переключение

На резерве: `bash /opt/mmo90s/infra/standby/failover.sh`. Скрипт откажется, если основной
отвечает: две живые базы потом не склеить. Для учебной тревоги сначала остановить игру на
основном (`docker compose -p mmo90s ... stop backend worker frontend`), потом `--force`.
После скрипта переключить A-записи kooperativ.space, www и admin на 85.198.67.48
и переставить секреты автовыкатки `VPS_*` на резерв.

## Возврат на основной

Бывший основной после аварии НЕ включать как есть: его база отстала, а Redis и worker
начнут работать со старыми данными. Порядок: остановить там игру и базу, удалить том
`mmo90s_mmo90s_postgres_data`, сделать его репликой нового основного (`pg_basebackup -R`
так же, как резерв настраивался), ночью переключиться обратно тем же `failover.sh`
в обратную сторону.
