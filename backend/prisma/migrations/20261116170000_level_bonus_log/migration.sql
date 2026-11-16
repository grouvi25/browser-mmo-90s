-- №133 (Metallica 16.11): премии за уровни видны в кошельке, раньше начислялись мимо журнала денег.
ALTER TYPE "CurrencyLogReason" ADD VALUE 'LEVEL_BONUS';
