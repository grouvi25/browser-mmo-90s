-- Выдача и списание ресурсов администратором из карточки игрока.
ALTER TYPE "AdminActionKind" ADD VALUE 'GRANT_RESOURCE';
ALTER TYPE "AdminActionKind" ADD VALUE 'TAKE_RESOURCE';
